if (process.env['NODE_ENV'] === 'production' || process.env['CI'] === 'true') process.exit(0);

const husky = (await import('husky')).default();
if (husky !== '') console.log(husky);
