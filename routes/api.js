const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const axios = require('axios');

const QA = false;

const VHS = `https://${QA ? 'qa-' : ''}api.cbtnuggets.com/video-historical/v2`;

let userToken = null;
let serviceToken = null;

const tagsToCreate = [
    {
        id: '530789a85e685125d127afce',
        title: 'Virtualization',
        seoslug: 'collection-virtualization',
        collection_count: 33
    },
    {
        id: '530789a85e685125d127afcf',
        title: 'Web Development',
        seoslug: 'web-development',
        collection_count: 14
    },
    {
        id: '530789a55e685125d127afa6',
        title: 'Scripting',
        seoslug: 'collection-scripting',
        collection_count: 16
    },
    {
        id: '5d0bfd6f3bcd5a03016b5133',
        title: 'UCS',
        seoslug: 'ucs',
        collection_count: 11
    }
];

async function getToken(tokenType) {
    try {
        const command = `cbt -e ${QA ? 'qa' : 'prod'} auth get_token ${
            tokenType === 'service' ? '-c service-studio-gateway' : ''
        }`;

        console.log('Requesting token', { command });

        const { stdout } = await exec(command);

        const output = stdout.toString().split('\n');
        const tokenOuput = output[6];

        const token = tokenOuput
            .replace('Access token: \u001b[36m', '')
            .replace('\u001b[39m', '');

        if (tokenType === 'service') {
            serviceToken = token;
        } else {
            userToken = token;
        }

        console.log(`${tokenType} token: ${token}`);
    } catch (error) {
        console.log(`Couldn't get token.`, { error });
    }
}

async function getAllTokens() {
    await getToken('service');
    await getToken('user');
}

module.exports = function() {
    const { app } = ExpressAppCore.getInstance();

    console.log('------');
    console.log('Environment:', QA ? 'QA' : 'PRODUCTION');

    app.get('/createtags', async (req, res) => {
        try {
            await getAllTokens();

            for (let i = 0; i < tagsToCreate.length; i++) {
                const tag = tagsToCreate[i];
                console.log(
                    `Checking tag "${tag.title}" (seoslug: "${tag.seoslug}")...`
                );

                try {
                    const getResult = await axios
                        // check if this slug already exists
                        .get(
                            `${VHS}/internal/tags/by/seoslugs/${tag.seoslug}?access_token=${serviceToken}`
                        );

                    if (getResult.data.length > 0) {
                        console.log(
                            `Seoslug "${tag.seoslug}" already exists.`,
                            {
                                data: getResult.data
                            }
                        );
                    } else {
                        console.log(
                            `Creating tag "${tag.title}" (seoslug: "${tag.seoslug}")...`
                        );

                        try {
                            const postTag = await axios
                                // create tags that do not exist in the database yet
                                .post(`${VHS}/tag?access_token=${userToken}`, {
                                    title: tag.title,
                                    seoslug: tag.seoslug
                                });
                        } catch (error) {
                            console.log('postTag', { error });
                        }
                    }
                } catch (error) {
                    console.log('getTag', { error });
                }
            }

            console.log('---');
            res.status(200).send('Done.');
        } catch (error) {
            console.log('Uncaught error', { error });
        }
    });
};
