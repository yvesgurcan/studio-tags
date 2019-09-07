const axios = require('axios');
const csvParser = require('csvtojson');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs').promises;
const _ = require('lodash');

const QA = true;
const VHS = `https://${QA ? 'qa-' : ''}api.cbtnuggets.com/video-historical/v2`;

let userToken = null;
let serviceToken = null;

let csvAssociations = [];
let csvTags = [];
let dbTags = [];

let dbCollections = [];
let dbCollectionsWithTags = [];
let dbCollectionsWithMissingTags = [];

const dbCollectionsInProd = require('../dump/prodCollections.json');
const dbCollectionsInQa = require('../dump/dbCollectionsInQa.json');

let csvTagsInProd = require('../dump/csvTagsInProd.json');
let csvTagsNotInProd = require('../dump/csvTagsNotInProd.json');

const backupTags = require('../data/tag_backup.json');
const backupCollections = require('../data/coll_backups.json');

/* TOKENS */

async function getToken(tokenType) {
    const { stdout } = await exec(
        `cbt -e ${QA ? 'qa' : 'prod'} auth get_token ${
            tokenType === 'service' ? '-c service-studio-gateway' : ''
        }`
    );

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

    // console.log(`${tokenType} token: ${token}`);
}

async function getAllTokens() {
    await getToken('service');
    await getToken('user');
}

/* API */

async function getTags() {
    if (dbTags.length > 0) {
        return tags;
    } else {
        return await axios(`${VHS}/tags?access_token=${userToken}`).then(
            ({ data: fetchedTags }) => {
                dbTags = fetchedTags;
            }
        );
    }
}

async function getCollections() {
    if (dbCollections.length > 0) {
        return dbCollections;
    } else {
        await axios(
            `${VHS}/internal/collections?access_token=${serviceToken}`
        ).then(({ data: fetchedCollections }) => {
            dbCollections = fetchedCollections;
        });
    }
}

/* FILES */

async function dumpJson(data, target) {
    const path = `${process.cwd()}/dump/${target}.json`;
    await fs.writeFile(path, JSON.stringify(data));
}

/* THE GOOD STUFF */

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

function getCsvTagsNotInProd() {
    const mergedCsvAndProdTags = _.mergeWith(csvTags, dbTags);
    csvTagsInProd = mergedCsvAndProdTags.filter(tag => tag.id);
    csvTagsNotInProd = mergedCsvAndProdTags.filter(tag => !tag.id);
}

function collectionWithTagsInQa() {
    dbCollectionsWithTags = dbCollections
        // match with PROD collections based on title
        .filter(dbColl =>
            dbCollectionsInProd
                .map(dbCollProd => dbCollProd.title)
                .includes(dbColl.title)
        )
        // has tags
        .filter(dbColl => dbColl.tags.length > 0)
        .map(dbColl => {
            const tagNames = dbColl.tags
                .map(collTag => {
                    const fullTag = dbTags.find(dbTag => dbTag.id === collTag);
                    return fullTag ? fullTag.title : null;
                })
                .filter(tag => tag);
            return {
                title: dbColl.title,
                tagNames
            };
        });
}

function collectionsWithMissingTags() {
    dbCollectionsWithMissingTags = dbCollectionsWithTags
        .map(dbColl => {
            const missingTags = dbColl.tagNames.filter(
                collTag =>
                    !csvTagsInProd.map(tag => tag.title).includes(collTag)
            );

            return {
                title: dbColl.title,
                missingTags
            };
        })
        .filter(dbColl => dbColl.missingTags.length > 0);
}

// NEXT: 

/* MAIN */

async function main() {
    try {
        console.log('------');
        console.log('Environment:', QA ? 'QA' : 'PRODUCTION');
        await getAssociationData();

        console.log('CSV Tags:', csvTags.length);
        console.log('CSV Tags in PROD:', csvTagsInProd.length);
        console.log('CSV Tags not in PROD:', csvTagsNotInProd.length);

        console.log('CSV Collections:', csvAssociations.length);

        await getAllTokens();
        await getTags();
        await getCollections();
        await collectionWithTagsInQa();

        collectionsWithMissingTags();

        console.log(
            'Collections in PROD missing tags present in QA:',
            dbCollectionsWithMissingTags,
            dbCollectionsWithMissingTags.length
        );
    } catch (error) {
        console.log({ error });
    }
}

main();
