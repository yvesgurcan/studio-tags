const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');
const axios = require('axios');
const exec = require('child_process').exec;
const fs = require('fs');
const csvParser = require('csvtojson');

let userToken = null;
let serviceToken = null;
let allTokens = false;

let collections = [];
let thetags = [];

const QA = false;

const VHS = `https://${QA ? 'qa-' : ''}api.cbtnuggets.com/video-historical/v2`;

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

console.log('Running in QA mode:', QA);

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
                    console.log(`Tag count: ${data.length}`);
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

                        /*
                         */

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

                        res.status(200).send({ missingCollections });
                        return;

                        const { start, end } = req.params;
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
                                            .replace('///g', '___')
                                            .replace(
                                                '/\u2013/g',
                                                '__DASH__'
                                            )}/${collection.tags
                                            .join(',')
                                            .replace('/[/]/g', '___')
                                            .replace('I/O', 'I___O')
                                            .replace('DoS/DDoS', 'DoS___DDoS')}`
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

    app.get('/tags/create', (req, res) => {
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
                                                .map(tag => tag.title)
                                                .indexOf(tag) === -1
                                    );

                                    console.log(
                                        `Tags not created yet: ${missingTags.length}`
                                    );

                                    console.log('Creating missing tags...');

                                    const batchOfMissingtags = missingTags;

                                    console.log(`Batch: ${batchOfMissingtags}`);

                                    Promise.all(
                                        batchOfMissingtags.map(
                                            async tagTitle => {
                                                const seoslug = tagTitle
                                                    .replace('/ /g', '-')
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
        const { title: t, tags: tt } = req.params;
        const tags = tt
            .replace('/___/g', '/')
            .replace('__DASH__', '/\u2013/g')
            .replace('I___O', 'I/O')
            .replace('DoS___DDoS', 'DoS/DDoS');
        const title = t.replace('/___/g', '/').replace('__DASH__', '/\u2013/g');
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
