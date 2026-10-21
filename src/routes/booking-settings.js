import { json, readBody } from '../lib/http.js';

export const bookingSettingsRoutes = [
  ['GET', /^\/api\/booking-settings$/, async context => json(await context.services.bookingSettings.public(context.query.campus))],
  ['GET', /^\/api\/booking-settings\/manage$/, async context => json(await context.services.bookingSettings.list(await context.permission('settings.manage'), context.query.campus))],
  ...[['settings', 'booking-settings'], ['notice', 'booking-notices']].map(([kind, path]) => ['PATCH', new RegExp(`^/api/${path}$`), async context => {
    const actor = await context.permission('settings.manage');
    await context.limit('write');
    return json(await context.services.bookingSettings.save(actor, await readBody(context.request), kind));
  }])
];
