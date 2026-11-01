# Bakcang Peneleh

Guest pre-order system with Midtrans Snap payments, built on Laravel 13.

Customers order without an account, pay through Midtrans, and track the order by
its number. Staff sign in to a single admin panel to manage the catalogue,
advance orders through the kitchen, and export reports.

---

## Requirements

| | Version | Note |
|---|---|---|
| PHP | 8.3 – 8.5 | Laravel 13 minimum is 8.3 |
| MySQL | 8.0+ | schema uses `ENUM` and `SUBSTRING_INDEX` |
| Node | 20+ | Vite 8 |
| Extensions | `zip`, `gd`, `bcmath`, `intl`, `pdo_mysql`, `mbstring`, `curl`, `openssl`, `fileinfo` | `zip` is required by Laravel Excel |

Extensions are declared in `composer.json`, so `composer install` fails fast if
one is missing rather than breaking at runtime.

## Setup

```bash
composer install
cp .env.example .env
php artisan key:generate

# create the database first
mysql -u root -e "CREATE DATABASE bakcang_peneleh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

php artisan migrate
php artisan db:seed          # admin account + product catalogue
php artisan storage:link     # product image uploads
npm install && npm run build
```

Default admin: `admin@bakcangpeneleh.test` / `password`. Change it immediately,
or set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before seeding.

Optional sample history for the dashboard and reports:

```bash
php artisan db:seed --class=DemoOrderSeeder
```

Run everything at once:

```bash
composer dev    # server + queue worker + log tail + vite
```

Public registration is disabled — customers never need an account, and an open
sign-up form would let anyone create a panel login. Add staff with:

```bash
php artisan bakcang:make-admin
```

## Midtrans

Fill these from the [Sandbox dashboard](https://dashboard.sandbox.midtrans.com)
under **Settings → Access Keys**:

```
MIDTRANS_MERCHANT_ID=
MIDTRANS_CLIENT_KEY=
MIDTRANS_SERVER_KEY=
MIDTRANS_IS_PRODUCTION=false
```

`MIDTRANS_SERVER_KEY` is the webhook signature secret — never expose it to the
browser. Only the client key is safe in Blade or JS.

### Webhook

Midtrans must reach `POST /webhook/midtrans`. Locally that needs a tunnel:

```bash
ngrok http 8000
```

Then set `MIDTRANS_WEBHOOK_HOST` to the HTTPS URL and register
`https://<host>/webhook/midtrans` in the dashboard under
**Settings → Configuration → Payment Notification URL**.

Without a tunnel, reconcile manually from **Admin → Pembayaran → Sinkronkan**,
which pulls authoritative status from the Midtrans API through the same
validation path as the webhook.

The queue must be running for customer emails to send:

```bash
php artisan queue:work
```

## Testing

```bash
php artisan test
```

Tests run against **MySQL**, not sqlite — `phpunit.xml` points at
`bakcang_peneleh_test`, which you must create once:

```bash
mysql -u root -e "CREATE DATABASE bakcang_peneleh_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

sqlite would be faster but wrong here: it does not enforce `ENUM` columns, which
would make the `authorize` / `partial_refund` regression test pass vacuously, and
it lacks `SUBSTRING_INDEX`, which order-number generation depends on.

## Architecture

```
Livewire / Controller   HTTP and validation only
        ↓
Service                 business rules, transactions, events
        ↓
Repository (interface)  queries only
        ↓
Model / MySQL
```

- `CartService` — session cart. Merges repeat additions of a product, because
  `order_items` carries `UNIQUE (order_id, product_id)`; prices are always
  re-read from the catalogue, never taken from the request.
- `OrderService` — transactional checkout. Generates `BP-YYYYMMDD-NNNN` and
  retries on a unique collision rather than serialising every checkout behind a
  lock.
- `MidtransService` — Snap wrapper. One `midtrans_order_id` per attempt
  (`{order_number}-{n}`), since Midtrans permanently rejects reuse.
- `PaymentNotificationService` — the webhook brain. See below.
- `OrderStatusService` — forward-only state machine.

### Webhook correctness

Four defences, in order:

1. **Signature** — `sha512(order_id + status_code + gross_amount + server_key)`,
   computed over the exact string Midtrans sent. Reformatting `gross_amount`
   breaks verification.
2. **Status re-query** — a valid signature proves the message was authentic when
   minted, not that it is current. Re-querying defeats a replay.
3. **Row lock** — Midtrans retries without waiting for the previous attempt, so
   concurrent deliveries must serialise.
4. **Precedence guard** — Midtrans guarantees no ordering, so a `pending` can
   arrive *after* the `settlement` it precedes. Applying it would un-pay a paid
   order.

Response codes are chosen for how Midtrans reacts: `403`/`404` for permanently
invalid notifications, `500` only for genuine server faults — the sole case
where a retry can help. Returning `500` otherwise traps Midtrans in an unbounded
retry loop.

Midtrans sends timestamps as bare WIB strings with no offset, so they are parsed
explicitly as `Asia/Jakarta`. `DB_TIMEZONE` must match `APP_TIMEZONE`, because
the schema stores payment times in `TIMESTAMP` columns that MySQL converts using
the session timezone.

## Schema notes

Four business tables, matching the original design. Two deltas:

- `orders.pickup_date`/`pickup_time` → `fulfillment_date`/`fulfillment_time`.
  Delivery orders previously had no scheduled date at all, so the kitchen could
  not produce a "due tomorrow" list for them.
- `payments.transaction_status` gained `authorize` and `partial_refund`.
  Midtrans emits both; under MySQL strict mode an unknown `ENUM` value raises
  error 1265 rather than truncating, which would 500 the webhook forever.

Constraints the code must respect:

- `order_items` has **no timestamp columns** — `OrderItem::$timestamps = false`,
  or every insert fails with `Unknown column 'created_at'`.
- `order_items.product_id` is `ON DELETE RESTRICT` and `products` has no soft
  delete, so an ordered product can never be hard-deleted. The UI reports this
  instead of surfacing integrity error 1451.
- Order paid-ness is **not** a column. It is the existence of a payment in
  `settlement` or `capture`; `orders.status = confirmed` is the business mirror
  written by the webhook. Revenue reporting reads `payments.settlement_time`, so
  unpaid orders never count as income.

## Deployment

```bash
composer install --no-dev --optimize-autoloader
npm run build
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan view:cache
php artisan storage:link
```

Set `APP_DEBUG=false` and `APP_ENV=production`, point `MIDTRANS_IS_PRODUCTION`
at `true` with live keys, and run `php artisan queue:work` under supervisor.
