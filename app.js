const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');

const settings = {
    appDir: __dirname,
    errorHandler: (error, req, res, next) => {
        console.error({ error });
        console.error('BOOM!');
        res.status(500).send();
    }
};

ExpressAppCore.construct(settings)
    .then(app => app.startServer())
    .catch(error => console.error({ error }));
