const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const axios = require('axios');
const csvParser = require('csvtojson');
const fs = require('fs').promises;

const QA = false;

const VHS = `https://${QA ? 'qa-' : ''}api.cbtnuggets.com/video-historical/v2`;

let userToken = null;
let serviceToken = null;

let csvAssociations = [];
let batch1 = require('../restoration/firstThird.json');

let batchWithSlugs = [];

let dbCollections = [];

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

/*
async function getTags() {
    try {
        const { data } = await axios(`${VHS}/tags?access_token=${userToken}`);
        dbTags = data;
        console.log(`DB tags: ${dbTags.length}`);
    } catch (error) {
        console.log('Couldnt get tags', { error });
    }
}
*/

/*
async function dumpJson(data, target) {
    const path = `${process.cwd()}/restoration/${target}.json`;
    await fs.writeFile(path, JSON.stringify(data));
}*/

/*
function getBatch() {
    const perBatch = missingTags.length / 3;
    const i = 2;
    const start = Math.ceil(perBatch * i);
    const end = Math.ceil(perBatch * (i + 1));
    const batch = missingTags.slice(start, end);
    console.log(batch1.length, batch2.length, batch3.length);
    // dumpJson(batch, 'lastThird');
}
*/

async function createTag(tag) {
    try {
        console.log(
            `Creating tag "${tag.title}" (seoslug: "${tag.seoslug}")...`
        );
        const putTagResult = await axios
            // create tags that do not exist in the database yet
            .post(`${VHS}/tag?access_token=${userToken}`, {
                title: tag.title,
                seoslug: tag.seoslug
            });
    } catch (error) {
        console.log(
            `Error creating tag: ${tag.title} - ${tag.seoslug}`,
            error.data
        );
    }

    return;
}

async function addSlugs(batch) {
    batchWithSlugs = batch
        .filter(tag => !tag.exists)
        .map(tag => {
            const seoslug = tag.title
                .replace(/ /g, '-')
                .replace(/[/]/g, '-')
                .replace(/\(/g, '-')
                .replace(/\)/g, '-')
                .replace(/\./g, 'dot')
                .toLowerCase();

            return {
                ...tag,
                seoslug
            };
        });
}

async function checkSlug(tag) {
    try {
        // check if this slug already exists
        console.log(
            `Checking tag "${tag.title}" (seoslug: "${tag.seoslug}")...`
        );
        const getTagResult = await axios.get(
            `${VHS}/internal/tags/by/seoslugs/${tag.seoslug}?access_token=${serviceToken}`
        );

        return getTagResult.data;
    } catch (error) {
        console.log(
            `Error checking tag: ${tag.title} - ${tag.seoslug}`,
            error.data
        );
        return [];
    }
}

async function main() {
    addSlugs(batch1);
    await getAllTokens();
    // for (let i = 0; i < batchWithSlugs.length; i++) {
    const item = batchWithSlugs[0];
    const exists = await checkSlug(item);
    let tagId = null;
    if (exists.length === 0) {
        createTag(item);
    } else {
        tagId = exists[0].id;
        console.log(
            `Tag "${item.title}" (seoslug: "${item.seoslug}") already exists:`,
            exists
        );
    }
    // }
}

main();
