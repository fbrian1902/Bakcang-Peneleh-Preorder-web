import forms from '@tailwindcss/forms';

/**
 * Deliberately minimal: Tailwind's default neutral scale plus one accent.
 * No custom fonts (the system stack is used), no custom animations, no
 * decorative radii or shadows.
 */
export default {
    content: [
        './vendor/laravel/framework/src/Illuminate/Pagination/resources/views/*.blade.php',
        './storage/framework/views/*.php',
        './resources/views/**/*.blade.php',
    ],

    theme: {
        extend: {
            colors: {
                accent: {
                    50: '#F1F7F3',
                    100: '#DCEBE1',
                    600: '#2E6B45',
                    700: '#245536',
                    800: '#1B4029',
                },
            },
        },
    },

    plugins: [forms],
};
