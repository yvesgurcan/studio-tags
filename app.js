const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');

const settings = {
    appDir: __dirname,
    errorHandler: (error, req, res) => {
        console.error({ error });
        res.status(500).send();
    }
};

ExpressAppCore.construct(settings)
    .then(app => app.startServer())
    .catch(error => console.error({ error }));
