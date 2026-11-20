/**
 * Names shown in the interface. Set them in Vercel (Settings → Environment Variables)
 * to use your own. Defaults are used when a variable is not set.
 */
export const APP_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) || 'Hotel PMS & ERP';
export const HOTEL_NAME = (import.meta.env.VITE_HOTEL_NAME as string | undefined) || 'Your Hotel';
