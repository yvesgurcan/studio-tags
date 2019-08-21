const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');

module.exports = function() {
    const { app, logger, routes } = ExpressAppCore.getInstance();
    app.get('/', (req, res) => {
        res.send('Running!');
    });
};
