const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');
const axios = require('axios');
const exec = require('child_process').exec;
const csvParser = require('csvtojson');

let userToken = null;
let serviceToken = null;
let allTokens = false;

let collections = [];
let thetags = [];

const QA = false;

const VHS = `https://${QA ? 'qa-' : ''}api.cbtnuggets.com/video-historical/v2`;

const doSlug = tagTitle =>
    tagTitle
        .replace(/ /g, '-')
        .replace(/\//g, '-')
        .toLowerCase();

const hasIllegalChars = string =>
    string.indexOf(' ') > -1 || string.indexOf('/') > -1;

function errorWrapper(promise, res) {
    return promise.catch(error => {
        console.error({ response: error.response.data });
        if (!res) {
            console.error(
                'Response object was not passed down to the error wrapper.'
            );
        } else {
            res.status(500).send(error.response.data);
        }
    });
}

console.log('Running in PRODUCTION:', !QA);

function getToken(callback, req, getUserToken = false) {
    if (allTokens) {
        callback(getUserToken ? userToken : serviceToken);
    } else {
        if ((getUserToken && !userToken) || (!getUserToken && !serviceToken)) {
            console.log(
                `Fetching ${getUserToken ? 'user' : 'service'} token...`
            );
            exec(
                `cbt -e ${QA ? 'qa' : 'prod'} auth get_token ${
                    getUserToken ? '' : '-c service-studio-gateway'
                }`,
                function(error, stdout, stderr) {
                    console.log(stdout);
                    const output = stdout.toString().split('\n');
                    const tokenOuput = output[6];
                    const token = tokenOuput
                        .replace('Access token: \u001b[36m', '')
                        .replace('\u001b[39m', '');

                    if (getUserToken) {
                        userToken = token;
                    } else {
                        serviceToken = token;
                    }

                    if (callback) {
                        callback(token);
                    } else {
                        console.log('getToken has no callback.');
                        req.status(200).send('Got token.');
                    }
                }
            );
        } else {
            console.log(
                `A ${
                    getUserToken ? 'user' : 'service'
                } token is already in memory.`
            );
            callback(getUserToken ? userToken : serviceToken);
        }
    }
}

function getAllTokens(callback) {
    allTokens = true;
    console.log(`Fetching both user and service tokens...`);
    exec(`cbt -e ${QA ? 'qa' : 'prod'} auth get_token`, function(
        error,
        stdout,
        stderr
    ) {
        console.log(stdout);
        const output = stdout.toString().split('\n');
        const tokenOuput = output[6];
        const token = tokenOuput
            .replace('Access token: \u001b[36m', '')
            .replace('\u001b[39m', '');

        userToken = token;

        exec(
            `cbt -e ${
                QA ? 'qa' : 'prod'
            } auth get_token -c service-studio-gateway`,
            function(error, stdout, stderr) {
                console.log(stdout);
                const output = stdout.toString().split('\n');
                const tokenOuput = output[6];
                const token = tokenOuput
                    .replace('Access token: \u001b[36m', '')
                    .replace('\u001b[39m', '');

                serviceToken = token;

                callback();
            }
        );
    });
}

function getCollections(callback, res) {
    if (collections.length > 0) {
        /*
        console.log(
            `Collections are already in memory. Collection count: ${collections.length}`
        );
        */
        if (callback) {
            callback({ _collections: collections });
        }
    } else {
        console.log('Fetching all collections...');
        getToken(_token =>
            errorWrapper(
                axios(`${VHS}/collections?access_token=${_token}`).then(
                    ({ data }) => {
                        collections = data;
                        console.log(`Collection count: ${data.length}`);
                        if (callback) {
                            callback({
                                _collections: collections
                            });
                        }
                    }
                )
            )
        );
    }
}

function getTags(callback, res) {
    if (thetags.length > 0) {
        /*
        console.log(`Tags are already in memory. Tag count: ${thetags.length}`);
        */
        if (callback) {
            callback({ _tags: thetags });
        }
    } else {
        console.log('Fetching all tags...');
        getToken(_token =>
            errorWrapper(
                axios(`${VHS}/tags?access_token=${_token}`).then(({ data }) => {
                    thetags = data;
                    console.log(`Tag count in DB: ${data.length}`);
                    if (callback) {
                        callback({
                            _tags: thetags
                        });
                    }
                })
            )
        );
    }
}

module.exports = function() {
    const { app } = ExpressAppCore.getInstance();

    return;

    app.get('/deletetags/:start/:end', (req, res) => {
        const { start, end } = req.params;

        return;

        getAllTokens(() => {
            csvParser()
                .fromFile('./data/new-tags-for-collections.csv')
                .then(data => {
                    const formattedData = data.map(row => ({
                        title: row['Collection Title'],
                        tags: row['Skill Tags']
                    }));

                    // get a list of the tags that were allegedly created from the data
                    const uniqueTags = [];

                    const sanitizedData = formattedData
                        .filter(row => row.tags)
                        .map(row => {
                            const sanitizedTags = row.tags
                                .split(',')
                                .map(tag => tag.trim())
                                .filter(tag => {
                                    if (
                                        tag &&
                                        tag !== '???' &&
                                        uniqueTags.indexOf(tag) === -1
                                    ) {
                                        uniqueTags.push(tag);
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

                    getTags(({ _tags: allTags }) => {
                        const existingTags = allTags.filter(dbTag =>
                            uniqueTags.includes(dbTag.title)
                        );

                        const batch = existingTags.slice(start, end);

                        batch.map(tag => {
                            axios
                                .delete(
                                    `${VHS}/tag/${tag.id}?access_token=${userToken}`
                                )
                                .then(result => {
                                    console.log(`--- success!`, {
                                        tag,
                                        result: result.data
                                    });
                                })
                                .catch(error => {
                                    console.log('--- error!', {
                                        tag,
                                        error: error.response.data
                                    });
                                });
                        });

                        res.status(200).send({ batch });
                    });
                });
        });
    });

    app.get('/fixtags/:dryrun/:start/:end', (req, res) => {
        const { dryrun, start, end } = req.params;
        console.log({ dryrun });
        getAllTokens(() => {
            csvParser()
                .fromFile('./data/new-tags-for-collections.csv')
                .then(data => {
                    const formattedData = data.map(row => ({
                        title: row['Collection Title'],
                        tags: row['Skill Tags']
                    }));

                    // get a list of the tags that were allegedly created from the data
                    const uniqueTags = [];

                    const sanitizedData = formattedData
                        .filter(row => row.tags)
                        .map(row => {
                            const sanitizedTags = row.tags
                                .split(',')
                                .map(tag => tag.trim())
                                .filter(tag => {
                                    if (
                                        tag &&
                                        tag !== '???' &&
                                        uniqueTags.indexOf(tag) === -1
                                    ) {
                                        uniqueTags.push(tag);
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

                    getAllTokens(() =>
                        getTags(({ _tags: allTags }) => {
                            console.log(
                                '--- only keep tags which already exist in the DB by comparing names'
                            );
                            const existingTags = allTags.filter(dbTag =>
                                uniqueTags.includes(dbTag.title)
                            );

                            console.log(
                                '--- only keep tags that would most likely produce slugs with illegal characters'
                            );
                            const tagsWithIllegalChars = existingTags.filter(
                                eTag => hasIllegalChars(eTag.title)
                            );

                            console.log(
                                `--- found ${tagsWithIllegalChars.length} tags which might have illegal characters in their slug`
                            );

                            // batch to run queries on

                            console.log('--- batch');

                            const tagsToProcess = tagsWithIllegalChars.slice(
                                start,
                                end
                            );

                            // no need to run the query
                            if (tagsToProcess.length === 0) {
                                res.status(200).send('No tags to process.');
                                return;
                            }

                            // can't run the query
                            if (tagsToProcess.length > 200) {
                                console.log(
                                    `--- tags to process: ${tagsToProcess.length}`
                                );
                                res.status(200).send(
                                    'Too many tags to process.'
                                );
                                return;
                            }

                            // just keep the IDs
                            console.log('--- keeping tag IDs');
                            const tagIds = tagsToProcess.map(tag => tag.id);

                            axios
                                .get(
                                    `${VHS}/internal/tags/by/ids/${tagIds.join(
                                        ','
                                    )}?access_token=${serviceToken}`
                                )
                                .then(({ data: retrievedTags }) => {
                                    console.log(
                                        '--- only keep tags which actually have illegal chars in their slugs'
                                    );
                                    const retrievedTagsWithIllegalChars = retrievedTags.filter(
                                        rTag => true //hasIllegalChars(rTag.seoslug)
                                    );

                                    console.log(
                                        `--- found ${retrievedTagsWithIllegalChars.length} tags to fix`
                                    );

                                    // don't change these values!!!
                                    const tagsThatWillProcess = retrievedTagsWithIllegalChars.slice(
                                        0,
                                        10
                                    );
                                    if (
                                        retrievedTagsWithIllegalChars.length > 5
                                    ) {
                                        console.log(
                                            `--- too many (${retrievedTagsWithIllegalChars.length}) tags to fix; only 10 will be processed`
                                        );
                                    }

                                    const tagsWithNewSlug = tagsThatWillProcess.map(
                                        tag => ({
                                            ...tag,
                                            new_seoslug: doSlug(tag.title)
                                        })
                                    );

                                    console.log(tagsWithNewSlug);

                                    if (dryrun === 'false') {
                                        if (tagsWithNewSlug.length === 0) {
                                            console.log('--- nothing to fix');
                                            res.status(200).send(
                                                'Nothing to fix.'
                                            );
                                            return;
                                        }

                                        console.log('--- doing it!');

                                        tagsWithNewSlug.map(tag => {
                                            console.log('--- processing tag', {
                                                tag
                                            });

                                            axios
                                                // check if this slug already exists
                                                .get(
                                                    `${VHS}/internal/tags/by/seoslugs/${tag.new_seoslug}?access_token=${serviceToken}`
                                                )
                                                .then(({ data }) => {
                                                    if (data.length > 0) {
                                                        console.log(
                                                            `--- SEOSLUG "${tag.new_seoslug}" ALREADY EXISTS. TAG "${tag.title}" WILL NOT BE UPDATED.`,
                                                            {
                                                                data
                                                            }
                                                        );
                                                    } else {
                                                        console.log(
                                                            `--- SEOSLUG "${tag.new_seoslug}" DOES NOT EXIST. TAG "${tag.title}" WILL BE UPDATED`
                                                        );

                                                        axios
                                                            // update tags with the new SEO slug
                                                            .post(
                                                                `${VHS}/tag/${tag.id}?access_token=${userToken}`,
                                                                {
                                                                    title:
                                                                        tag.title,
                                                                    seoslug:
                                                                        tag.new_seoslug
                                                                }
                                                            )
                                                            .then(result => {
                                                                console.log(
                                                                    `--- success! slug of tag '${tag.title} was replaced: '${tag.seoslug}' -> '${tag.new_seoslug}'`
                                                                );
                                                            })
                                                            .catch(error => {
                                                                console.log(
                                                                    '--- error!',
                                                                    {
                                                                        tag,
                                                                        error:
                                                                            error
                                                                                .response
                                                                                .data
                                                                    }
                                                                );
                                                            });
                                                    }
                                                })
                                                .catch(error => {
                                                    console.error(
                                                        `--- ERROR WHILE CHECKING IF SEOSLUG "${tag.new_seoslug}" EXISTS.`,
                                                        { error }
                                                    );
                                                });
                                        });

                                        res.status(200).send(
                                            'Working on it...'
                                        );
                                    } else {
                                        console.log('--- dryrun end');

                                        res.status(200).send({
                                            tagsWithNewSlug
                                        });
                                    }
                                })
                                .catch(errorResponse => {
                                    console.log(errorResponse.data);
                                    res.status(500).send(
                                        `Could not query /internal/tags/by/ids/${tagIds.join(
                                            ','
                                        )}`
                                    );
                                });
                        }, res)
                    );
                });
        });
    });

    app.get('/associate/:start/:end', (req, res) => {
        csvParser()
            .fromFile('./data/new-tags-for-collections.csv')
            .then(data => {
                const formattedData = data.map(row => ({
                    title: row['Collection Title'],
                    tags: row['Skill Tags']
                }));

                const sanitizedData = formattedData
                    .filter(row => row.tags)
                    .map(row => {
                        const uniqueTags = [];
                        const sanitizedTags = row.tags
                            .split(',')
                            .map(tag => tag.trim())
                            .filter(tag => {
                                if (
                                    tag &&
                                    tag !== '???' &&
                                    uniqueTags.indexOf(tag) === -1
                                ) {
                                    uniqueTags.push(tag);
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

                getAllTokens(() =>
                    getCollections(({ _collections }) => {
                        const foundCollections = sanitizedData.filter(data =>
                            _collections.find(
                                collection => data.title === collection.title
                            )
                        );

                        console.log(
                            `Collections to process found in CSV: ${sanitizedData.length}.`
                        );

                        console.log(
                            `Collections to process found in DB: ${foundCollections.length}.`
                        );

                        const missingCollections = sanitizedData.filter(
                            data =>
                                !foundCollections.find(
                                    collection =>
                                        data.title === collection.title
                                )
                        );

                        console.log(
                            `${missingCollections.length} collections to process were not found.`,
                            { missingCollections }
                        );

                        const { start, end } = req.params;

                        if (start === '0' && end === '0') {
                            console.log('DRY RUN.');
                            res.status(200).send({ missingCollections });
                            return;
                        }

                        const collectionBatch = foundCollections.slice(
                            start,
                            end
                        );

                        console.log('Collections to process:', collectionBatch);

                        // put tags in memory
                        getTags(({ _tags }) => {
                            return Promise.all(
                                collectionBatch.map(async collection => {
                                    const url = encodeURI(
                                        `http://localhost:3000/dontcreatetags/collection/${collection.title
                                            .replace(/[/]/g, '___')
                                            .replace(
                                                /\u2013/g,
                                                '__DASH__'
                                            )}/${collection.tags
                                            .join(',')
                                            .replace(/[/]/g, '___')}`
                                    );

                                    console.log({ url });
                                    return await axios(url);
                                })
                            )
                                .then(batchRequestStatuses => {
                                    console.log({
                                        batchRequestStatuses
                                    });

                                    const responses = batchRequestStatuses.map(
                                        request => ({
                                            status: request.status,
                                            statusText: request.statusText
                                        })
                                    );

                                    res.status(200).send({
                                        responses
                                    });
                                })
                                .catch(error => {
                                    console.error({ error });
                                    res.status(400).send(
                                        'Something went wrong :('
                                    );
                                });
                        }, res);
                    })
                );
            });
    });

    app.get('/tags/create/:start/:end', (req, res) => {
        csvParser()
            .fromFile('./data/new-tags-for-collections.csv')
            .then(data => {
                const formattedData = data.map(row => ({
                    title: row['Collection Title'],
                    tags: row['Skill Tags']
                }));

                const sanitizedData = formattedData
                    .filter(row => row.tags)
                    .map(row => {
                        const uniqueTags = [];
                        const sanitizedTags = row.tags
                            .split(',')
                            .map(tag => tag.trim())
                            .filter(tag => {
                                if (
                                    tag &&
                                    tag !== '???' &&
                                    uniqueTags.indexOf(tag) === -1
                                ) {
                                    uniqueTags.push(tag);
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
                    .sort((a, b) => (a.title > b.title ? 1 : -1));

                console.log('Getting all tags...');
                getToken(
                    _token =>
                        errorWrapper(
                            axios(`${VHS}/tags?access_token=${_token}`).then(
                                ({ data: allTags }) => {
                                    console.log(
                                        `Tag count in DB: ${allTags.length}`
                                    );

                                    const totalTagsToProcess = [];

                                    sanitizedData.map(row =>
                                        row.tags.map(tagToAdd => {
                                            if (
                                                allTags.indexOf(tagToAdd) === -1
                                            ) {
                                                if (
                                                    totalTagsToProcess.indexOf(
                                                        tagToAdd
                                                    ) === -1
                                                ) {
                                                    totalTagsToProcess.push(
                                                        tagToAdd
                                                    );
                                                }
                                            }
                                        })
                                    );

                                    console.log(
                                        `Tags to process in CSV: ${totalTagsToProcess.length}`
                                    );

                                    const missingTags = totalTagsToProcess.filter(
                                        tag =>
                                            allTags
                                                .map(tag =>
                                                    tag.title.toLowerCase()
                                                )
                                                .indexOf(tag.toLowerCase()) ===
                                                -1 &&
                                            [
                                                'Cloud Infrastructure',
                                                'Network Security',
                                                'Linux Security',
                                                'Salesforce'
                                            ].indexOf(tag) === -1
                                    );

                                    console.log(
                                        `Tags not created yet: ${missingTags.length}`
                                    );

                                    const { start, end } = req.params;

                                    if (start === '0' && end === '0') {
                                        const projectionMissingTags = missingTags.map(
                                            tagTitle => ({
                                                title: tagTitle,
                                                seoslug: tagTitle
                                                    .replace(/ /g, '-')
                                                    .replace(/[/]/g, '-')
                                                    .replace(/\(/g, '-')
                                                    .replace(/\)/g, '-')
                                                    .toLowerCase()
                                            })
                                        );

                                        console.log({ projectionMissingTags });

                                        console.log('DRY RUN.');
                                        res.status(200).send({ missingTags });
                                        return;
                                    }

                                    console.log('Creating missing tags...');

                                    const batchOfMissingtags = missingTags.slice(
                                        start,
                                        end
                                    );

                                    console.log(`Batch: ${batchOfMissingtags}`);

                                    Promise.all(
                                        batchOfMissingtags.map(
                                            async tagTitle => {
                                                const seoslug = tagTitle
                                                    .replace(/ /g, '-')
                                                    .replace(/[/]/g, '-')
                                                    .replace(/\(/g, '-')
                                                    .replace(/\)/g, '-')
                                                    .toLowerCase();
                                                console.log(
                                                    `Creating tag "${tagTitle}" (seoslug: "${seoslug}")...`
                                                );
                                                return await axios
                                                    // create tags that do not exist in the database yet
                                                    .post(
                                                        `${VHS}/tag?access_token=${_token}`,
                                                        {
                                                            title: tagTitle,
                                                            seoslug
                                                        }
                                                    )
                                                    .then(result => {
                                                        return {
                                                            tagTitle,
                                                            status:
                                                                result.status
                                                        };
                                                    })
                                                    .catch(error => {
                                                        console.log({
                                                            error:
                                                                error.response
                                                                    .data
                                                        });
                                                        return {
                                                            tagTitle,
                                                            status:
                                                                error.response
                                                                    .status,
                                                            result:
                                                                error.response
                                                                    .data
                                                        };
                                                    });
                                            }
                                        )
                                    ).then(createTagResults => {
                                        console.log({
                                            createTagResults
                                        });

                                        res.status(200).send(createTagResults);
                                    });
                                }
                            ),
                            res
                        ),
                    res,
                    true
                );
            });
    });

    // get collection details (including tags) by collection title and apply tags to it
    app.get('/dontcreatetags/collection/:title/:tags', (req, res) => {
        // DEBUG
        const dryrun = true;

        const { title: t, tags: tt } = req.params;
        const tags = tt.replace(/___/g, '/');
        const title = t.replace(/___/g, '/').replace(/__DASH__/g, '-');
        // console.log(`*** COLLECTION: "${title} / TAGS: "${tags}".`);
        // trim
        const tagsToApply = tags
            .split(',')
            .map(tag => tag.trim().replace('/___/g', '/'));
        // get all collections (whether cached or from a request)
        getCollections(({ _collections }) => {
            const collection = _collections.find(
                collection => collection.title === title
            );
            // console.log(`Finding collection "${title}"...`);
            // console.log({ collection });

            if (!collection) {
                console.error(`??? Collection "${title}" not found. ???`);
                return res.status(404).send(`Collection "${title}" not found.`);
            }

            console.log(`Getting details of collection "${title}"...`);

            getToken(_token =>
                errorWrapper(
                    // get tags in this collection
                    axios
                        .get(
                            `${VHS}/internal/collections/by/ids/${collection.id}?populate_videos=false&access_token=${_token}`
                        )
                        .catch(({ error }) => {
                            console.log({ error });
                        })
                        .then(({ data: collectionDetails }) => {
                            const collectionsTags = collectionDetails[0].tags.join(
                                ','
                            );

                            /*
                            console.log(
                                `Getting tag details for collection "${title}"...`
                            );
                            */
                            //console.log({ collectionsTags });
                            getToken(_token =>
                                errorWrapper(
                                    // get tag title of the tags in the collection
                                    axios
                                        .get(
                                            !collectionsTags
                                                ? 'http://localhost:3000'
                                                : `${VHS}/internal/tags/by/ids/${collectionsTags}?access_token=${_token}`
                                        )
                                        .then(({ data }) => {
                                            let existingTags;
                                            if (!collectionsTags) {
                                                existingTags = [];
                                            } else {
                                                existingTags = data;
                                            }

                                            // console.log({ existingTags });

                                            const tagTitles = existingTags.map(
                                                // trimming
                                                tag => tag.title.trim()
                                            );
                                            const collectionTitle =
                                                collectionDetails[0].title;

                                            /*
                                            console.log(
                                                `Comparing current tags for collection "${collectionTitle}" with the list of tags provided...`
                                            );
                                            */

                                            const tagsToAdd = tagsToApply.filter(
                                                tag => {
                                                    return (
                                                        tagTitles.indexOf(
                                                            tag
                                                        ) === -1
                                                    );
                                                }
                                            );

                                            /*
                                            console.log(
                                                `Found ${tagsToAdd.length} tags to add to the collection "${collectionTitle}":`,
                                                { tagsToAdd }
                                            );
                                            */

                                            const missingTags = tagsToAdd.filter(
                                                tag =>
                                                    thetags
                                                        .map(tag => tag.title)
                                                        .indexOf(tag) === -1
                                            );

                                            if (missingTags.length > 0) {
                                                console.log(
                                                    `!!! ${missingTags.length} tag(s) not found in the database. Tags will not be created. !!!`,
                                                    {
                                                        missingTags
                                                    }
                                                );
                                            }

                                            const tagToAddIds = thetags
                                                .filter(
                                                    dbTag =>
                                                        tagsToAdd.indexOf(
                                                            dbTag.title
                                                        ) !== -1
                                                )
                                                .map(tag => tag.id);

                                            if (tagToAddIds.length === 0) {
                                                console.log(
                                                    `No tags need to be added to "${collectionTitle}". End of request.`
                                                );
                                                res.status(200).send(
                                                    tagTitles,
                                                    collectionTitle,
                                                    tagsToAdd
                                                );
                                                return;
                                            }

                                            console.log(
                                                `${tagToAddIds.length} tag(s) will be added to collection "${title}". ${missingTags.length}  tag(s) not found.`,
                                                {
                                                    tagToAddIds
                                                }
                                            );

                                            const mergedTagList = [
                                                ...tagToAddIds,
                                                ...existingTags.map(
                                                    tag => tag.id
                                                )
                                            ];

                                            if (dryrun) {
                                                res.status(200).send({
                                                    tagTitles,
                                                    collectionTitle,
                                                    tagsToAdd
                                                });
                                                return;
                                            }

                                            console.log(
                                                `Updating collection "${collectionTitle}"...`
                                            );

                                            getToken(
                                                _token =>
                                                    errorWrapper(
                                                        // associate the tags to add with the collection
                                                        axios
                                                            .post(
                                                                `${VHS}/collection/${collection.id}?access_token=${_token}`,
                                                                {
                                                                    tags: mergedTagList
                                                                }
                                                            )
                                                            .then(() => {
                                                                res.status(
                                                                    200
                                                                ).send({
                                                                    tagTitles,
                                                                    collectionTitle,
                                                                    tagsToAdd
                                                                });
                                                            })
                                                            .catch(error => {
                                                                console.log({
                                                                    error
                                                                });
                                                                res.status(
                                                                    500
                                                                ).send({
                                                                    collectionTitle,
                                                                    tagTitles,
                                                                    tagsToAdd,
                                                                    error:
                                                                        error
                                                                            .response
                                                                            .data,
                                                                    status:
                                                                        error
                                                                            .response
                                                                            .status
                                                                });
                                                            })
                                                    ),
                                                res,
                                                true
                                            );
                                        }),
                                    res
                                )
                            );
                        }),
                    res
                )
            );
        }, res);
    });

    /*

    // get all collections
    app.get('/collections', (req, res) => {
        getCollections(({ _collections }) => {
            res.status(200).send(_collections);
        }, res);
    });

    // get a collection by title
    app.get('/collection/:title', (req, res) => {
        const { title } = req.params;
        console.log(`Getting collection tags for "${title}"...`);
        let collection = {};
            console.log('Collections are already in memory.');
            collection = collections.find(
                collection => collection.title === title
            );
            console.log('Finding collection...');
            console.log({ collection });
            res.status(200).send({ collection });
        } else {
            getToken(_token =>
         if (collections.length > 0) {
               errorWrapper(
                    axios(`${VHS}/collections?access_token=${_token}`).then(
                        ({ data }) => {
                            console.log('Fetching all collections...');
                            collections = data;
                            collection = data.find(
                                collection => collection.title === title
                            );
                            console.log('Finding collection...');
                            console.log({ collection });
                            res.status(200).send({ collection });
                        }
                    ),
                    res
                )
            );
        }
    });

    app.get('/tag/post/:title/:seoslug', (req, res) => {
        const { title, seoslug } = req.params;
        console.log(`Creating tag (title: ${title}, seoslug: ${seoslug})...`);
        getToken(_token =>
            errorWrapper(
                axios
                    .post(`${VHS}/tag/?access_token=${_token}`, {
                        title,
                        seoslug
                    })
                    .then(({ data }) => {
                        console.log({ data });
                        res.status(200).send(data);
                    }),
                res
            )
        );
    });

    app.get('/tag/:title', (req, res) => {
        const { title } = req.params;
        console.log(`Getting tag by title "${title}"...`);
        getToken(_token =>
            errorWrapper(
                axios(`${VHS}/tags?access_token=${_token}`).then(({ data }) => {
                    const tag = data.find(tag => (tag.title = title));
                    res.status(200).send({ tag });
                }),
                res
            )
        );
    });

    app.get('/tags', (req, res) => {
        console.log('Getting all tags...');
        getToken(_token =>
            errorWrapper(
                axios(`${VHS}/tags?access_token=${_token}`).then(({ data }) => {
                    console.log({ data });
                    console.log(`Tag count: ${data.length}`);
                    res.status(200).send({ count: data.length, tags: data });
                }),
                res
            )
        );
    });
    */

    /* Util */

    app.get('/tag/create/:title/:seoslug', (req, res) => {
        const { title: t, seoslug } = req.params;
        const title = t.replace('___', '/');
        console.log(`Creating tag (title: ${title}, seoslug: ${seoslug})...`);
        getToken(_token =>
            errorWrapper(
                axios
                    .post(`${VHS}/tag/?access_token=${_token}`, {
                        title,
                        seoslug
                    })
                    .then(({ data }) => {
                        console.log({ data });
                        console.log(`Getting tag by title "${title}"...`);
                        getToken(_token =>
                            errorWrapper(
                                axios(
                                    `${VHS}/tags?access_token=${_token}`
                                ).then(({ data }) => {
                                    const tag = data.find(
                                        tag => (tag.title = title)
                                    );
                                    console.log({ tag });
                                    res.status(200).send({ tag });
                                }),
                                res
                            )
                        );
                    }),
                res
            )
        );
    });

    app.get('/tag/delete/:id', (req, res) => {
        console.log(`Deleting tag ${req.params.id}...`);
        getToken(_token =>
            errorWrapper(
                axios
                    .delete(
                        `${VHS}/tag/${req.params.id}?access_token=${_token}`
                    )
                    .then(response => {
                        console.log(response);
                        res.status(200).send(response);
                    }),
                res
            )
        );
    });

    app.get('/', (req, res) => {
        res.status(200).send('Running!');
    });

    app.get('/token', (req, res) => {
        exec('cbt -e qa auth get_token', function(error, stdout, stderr) {
            console.log(stdout);
            const output = stdout.toString().split('\n');
            const tokenOuput = output[6];
            const _token = tokenOuput
                .replace('Access token: \u001b[36m', '')
                .replace('\u001b[39m', '');
            token = _token;
            res.status(200).send(_token);
        });
    });

    app.get('/token/verify', (req, res) => {
        console.log('Checking token...');
        console.log({ token });
        res.status(200).send(token || 'No token found in memory.');
    });
};
