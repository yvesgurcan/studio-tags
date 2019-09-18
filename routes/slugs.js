const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const axios = require('axios');
const csvParser = require('csvtojson');

const QA = false;

const VHS = `https://${QA ? 'qa-' : ''}api.cbtnuggets.com/video-historical/v2`;

let userToken = null;
let serviceToken = null;

let csvAssociations = [];
let csvTags = [];
let dbTags = [];
let mergedTags = [];
let potentiallyBad = [];
let fullTags = [];
let badTags = [];

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

    app.get('/updateslugs', async (req, res) => {
        try {
            await getAllTokens();
        } catch (error) {
            console.log('Uncaught error', { error });
        }
    });
};

async function getAssociationData() {
    const data = await csvParser().fromFile(
        './data/new-tags-for-collections.csv'
    );

    const formattedData = data.map(row => ({
        title: row['Collection Title'],
        tags: row['Skill Tags']
    }));

    const uniqueCsvTags = [];

    // FIXED
    csvAssociations = formattedData
        .filter(row => row.tags)
        .map(row => {
            const sanitizedTags = row.tags
                .split(',')
                .map(tag => tag.trim())
                .filter(tag => {
                    if (
                        uniqueCsvTags
                            .map(csvTag => csvTag.title)
                            .indexOf(tag) === -1
                    ) {
                        uniqueCsvTags.push({ title: tag, collections: [] });
                    }

                    if (tag && tag !== '???') {
                        return true;
                    }

                    return false;
                })
                .sort((a, b) => (a > b ? 1 : -1));

            return {
                ...row,
                tags: sanitizedTags
            };
        })
        .filter(row => row.tags.length > 0)
        .sort((a, b) => (a.title > b.title ? 1 : -1));

    csvTags = uniqueCsvTags
        .sort((a, b) => (a.title > b.title ? 1 : -1))
        .map(csvTag => {
            const matchCollections = csvAssociations
                .filter(csvAssociation => {
                    return csvAssociation.tags.includes(csvTag.title);
                })
                .map(csvAssociation => {
                    return csvAssociation.title;
                });

            return {
                ...csvTag,
                collections: matchCollections
            };
        });
}

async function getTags() {
    try {
        const { data } = await axios(`${VHS}/tags?access_token=${userToken}`);
        dbTags = data;
    } catch (error) {
        console.log('Couldnt get tags', { error });
    }
}

const getPotentiallyBadTags = () => {
    potentiallyBad = csvTags.filter(
        csvTag =>
            csvTag.title.indexOf(' ') > -1 || csvTag.title.indexOf('/') > -1
    );
    // console.log({ potentiallyBad });
};

function mergeCsvAndDbTags() {
    mergedTags = potentiallyBad
        .map(csvTag => {
            const matchTag = dbTags.find(dbTag => csvTag.title === dbTag.title);
            return {
                ...csvTag,
                ...matchTag
            };
        })
        .filter(mergedTag => mergedTag.id);
}

async function getSlugs() {
    const perBatch = 50;
    const batchCount = Math.floor(mergedTags.length / perBatch);
    for (let i = 0; i < batchCount; i++) {
        try {
            const tagIds = mergedTags
                .slice(i * perBatch, (i + 1) * perBatch)
                .map(tag => tag.id)
                .join(',');
            // console.log({ tagIds }, i * perBatch, (i + 1) * perBatch);
            const result = await axios.get(
                `${VHS}/internal/tags/by/ids/${tagIds}?access_token=${serviceToken}`
            );

            if (result.status === 200) {
                fullTags = [...fullTags, ...result.data];
            } else {
                console.log('Didnt get a 200 for internal tags.');
            }
        } catch (error) {
            console.log('Couldnt get internal tags.', { error });
        }
    }
}

function checkBadSlugs() {
    badTags = fullTags.filter(fullTag => {
        const hasBadChar =
            fullTag.seoslug.indexOf(' ') > -1 ||
            fullTag.seoslug.indexOf('/') > -1;
        return hasBadChar;
    });
    console.log({ badTags });
}

async function main() {
    await getAssociationData();
    getPotentiallyBadTags();
    await getAllTokens();
    await getTags();
    mergeCsvAndDbTags();
    await getSlugs();
    checkBadSlugs();
}

main();
