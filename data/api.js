const ExpressAppCore = require('@cbtnuggets/lib-express-app-core-nodejs');
const axios = require('axios');
const exec = require('child_process').exec;
const fs = require('fs');
const csvParser = require('csvtojson');

let token = null;
let userToken = null;
let collections = [];

const VHS = 'https://qa-api.cbtnuggets.com/video-historical/v2';

function errorWrapper(promise, res) {
    promise.catch(error => {
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

function getToken(callback, req, getUserToken = false) {
    if (!token || getUserToken !== userToken) {
        console.log(`Fetching ${getUserToken ? 'user' : 'service'} token...`);
        exec(
            `cbt -e qa auth get_token ${
                getUserToken ? '' : '-c service-studio-gateway'
            }`,
            function(error, stdout, stderr) {
                console.log(stdout);
                const output = stdout.toString().split('\n');
                const tokenOuput = output[6];
                const _token = tokenOuput
                    .replace('Access token: \u001b[36m', '')
                    .replace('\u001b[39m', '');
                token = _token;
                userToken = getUserToken;

                if (callback) {
                    callback(_token);
                } else {
                    console.log('getToken has no callback.');
                    req.status(200).send('Got token.');
                }
            }
        );
    } else {
        console.log('Token already in memory.');
        callback(token);
    }
}

function getCollections(callback, res) {
    if (collections.length > 0) {
        console.log(
            `Collections are already in memory. Collection count: ${collections.length}`
        );
        if (callback) {
            callback({ _token: token, _collections: collections });
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
                                _token: token,
                                _collections: collections
                            });
                        }
                    }
                )
            )
        );
    }
}

// TODO: endpoint to collect not found collections

module.exports = function() {
    const { app } = ExpressAppCore.getInstance();

    app.get('/start', (req, res) => {
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

                    console.log(
                        `${sanitizedData.length -
                            foundCollections.length} collections to process were not found.`
                    );

                    console.log('Getting all tags...');
                    getToken(_token =>
                        errorWrapper(
                            axios(`${VHS}/tags?access_token=${_token}`).then(
                                ({ data }) => {
                                    console.log(`Tag count: ${data.length}`);

                                    const totalTagsToCreate = [];
                                    const tagAssociations = [];

                                    sanitizedData.map(row =>
                                        row.tags.map(tagToAdd => {
                                            tagAssociations.push(tagToAdd);
                                            if (data.indexOf(tagToAdd) === -1) {
                                                if (
                                                    totalTagsToCreate.indexOf(
                                                        tagToAdd
                                                    ) === -1
                                                ) {
                                                    totalTagsToCreate.push(
                                                        tagToAdd
                                                    );
                                                }
                                            }
                                        })
                                    );

                                    console.log(
                                        `Tags to create: ${totalTagsToCreate.length}`
                                    );

                                    console.log(
                                        `Tags associations: ${tagAssociations.length}`
                                    );

                                    // TODO: paste the rest of the requests here with a loop over foundCollections

                                    res.status(200).send({
                                        associations: foundCollections,
                                        collections: foundCollections.map(
                                            collection => collection.title
                                        ),
                                        tags: totalTagsToCreate.sort((a, b) =>
                                            a > b ? 1 : -1
                                        )
                                    });
                                }
                            ),
                            res
                        )
                    );
                });
            });
    });

    // get collection details (including tags) by collection title and apply tags to it
    app.get('/collection/:title/:tags', (req, res) => {
        const { title, tags } = req.params;
        // trim
        const tagsToApply = tags.split(',').map(tag => tag.trim());
        console.log(`Getting collection tags for "${title}"...`);
        // get all collections (whether cached or from a request)
        getCollections(({ _collections }) => {
            const collection = _collections.find(
                collection => collection.title === title
            );
            console.log('Finding collection...');
            console.log({ collection });

            if (!collection) {
                console.error(`Collection "${title}" not found.`);
                return res.status(404).send(`Collection "${title}" not found.`);
            }

            console.log('Getting collection details...');

            getToken(_token =>
                errorWrapper(
                    // get tags in this collection
                    axios
                        .get(
                            `${VHS}/internal/collections/by/ids/${collection.id}?populate_videos=false&access_token=${_token}`
                        )
                        .then(({ data: collectionDetails }) => {
                            console.log({ collectionDetails });
                            const collectionsTags = collectionDetails[0].tags.join(
                                ','
                            );

                            console.log('Getting tag details...');
                            console.log({ collectionsTags });
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

                                            console.log({ existingTags });

                                            const tagTitles = existingTags.map(
                                                // trimming
                                                tag => tag.title.trim()
                                            );
                                            const collectionTitle =
                                                collectionDetails[0].title;

                                            console.log(
                                                `Comparing current collection tags with the list of tags provided "${tagsToApply}"...`
                                            );

                                            const tagsToAdd = tagsToApply.filter(
                                                tag => {
                                                    return (
                                                        tagTitles.indexOf(
                                                            tag
                                                        ) === -1
                                                    );
                                                }
                                            );

                                            console.log(
                                                `Found ${tagsToAdd.length} tags to add to the collection:`,
                                                { tagsToAdd }
                                            );

                                            console.log('Getting all tags...');
                                            getToken(
                                                _token =>
                                                    errorWrapper(
                                                        // get all tags
                                                        axios
                                                            .get(
                                                                `${VHS}/tags?access_token=${_token}`
                                                            )
                                                            .then(
                                                                ({
                                                                    data: allTags
                                                                }) => {
                                                                    console.log(
                                                                        `Tag count: ${allTags.length}`
                                                                    );

                                                                    console.log(
                                                                        'Checking if tags to add exists in the database...'
                                                                    );

                                                                    const missingTags = tagsToAdd.filter(
                                                                        tag =>
                                                                            allTags
                                                                                .map(
                                                                                    tag =>
                                                                                        tag.title
                                                                                )
                                                                                .indexOf(
                                                                                    tag
                                                                                ) ===
                                                                            -1
                                                                    );

                                                                    console.log(
                                                                        `${missingTags.length} tags were not found in the database.`,
                                                                        {
                                                                            missingTags
                                                                        }
                                                                    );

                                                                    Promise.all(
                                                                        missingTags.map(
                                                                            async tagTitle => {
                                                                                const seoslug = tagTitle
                                                                                    .replace(
                                                                                        ' ',
                                                                                        '-'
                                                                                    )
                                                                                    .toLowerCase();
                                                                                console.log(
                                                                                    `Creating tag "${tagTitle}" (seoslug: ${seoslug})...`
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
                                                                                    .then(
                                                                                        result => {
                                                                                            return {
                                                                                                tagTitle,
                                                                                                result:
                                                                                                    result.status
                                                                                            };
                                                                                        }
                                                                                    )
                                                                                    .catch(
                                                                                        error => {
                                                                                            console.log(
                                                                                                `Tag creation didnt work for "${tagTitle}" :(`,
                                                                                                {
                                                                                                    error:
                                                                                                        error
                                                                                                            .response
                                                                                                            .data
                                                                                                }
                                                                                            );
                                                                                            return {
                                                                                                tagTitle,
                                                                                                result: `ERROR: ${error.response.status}`
                                                                                            };
                                                                                        }
                                                                                    );
                                                                            }
                                                                        )
                                                                    ).then(
                                                                        createTagResults => {
                                                                            console.log(
                                                                                {
                                                                                    createTagResults
                                                                                }
                                                                            );

                                                                            console.log(
                                                                                'Refetching tag list...'
                                                                            );

                                                                            getToken(
                                                                                _token =>
                                                                                    errorWrapper(
                                                                                        // get all tags again
                                                                                        axios
                                                                                            .get(
                                                                                                `${VHS}/tags?access_token=${_token}`
                                                                                            )
                                                                                            .then(
                                                                                                ({
                                                                                                    data: allTagsRefreshed
                                                                                                }) => {
                                                                                                    const tagToAddIds = allTagsRefreshed
                                                                                                        .filter(
                                                                                                            dbTag =>
                                                                                                                tagsToAdd.indexOf(
                                                                                                                    dbTag.title
                                                                                                                ) !==
                                                                                                                -1
                                                                                                        )
                                                                                                        .map(
                                                                                                            tag =>
                                                                                                                tag.id
                                                                                                        );

                                                                                                    console.log(
                                                                                                        `Adding ${tagToAddIds.length} tags to the collection...`,
                                                                                                        {
                                                                                                            tagToAddIds
                                                                                                        }
                                                                                                    );

                                                                                                    const mergedTagList = [
                                                                                                        ...tagToAddIds,
                                                                                                        ...existingTags.map(
                                                                                                            tag =>
                                                                                                                tag.id
                                                                                                        )
                                                                                                    ];

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
                                                                                                                    .then(
                                                                                                                        () => {
                                                                                                                            res.status(
                                                                                                                                200
                                                                                                                            ).send(
                                                                                                                                {
                                                                                                                                    tagTitles,
                                                                                                                                    collectionTitle,
                                                                                                                                    tagsToAdd
                                                                                                                                }
                                                                                                                            );
                                                                                                                        }
                                                                                                                    )
                                                                                                                    .catch(
                                                                                                                        error => {
                                                                                                                            console.log(
                                                                                                                                {
                                                                                                                                    error
                                                                                                                                }
                                                                                                                            );
                                                                                                                        }
                                                                                                                    )
                                                                                                            ),
                                                                                                        res,
                                                                                                        true
                                                                                                    );
                                                                                                }
                                                                                            )
                                                                                    )
                                                                            );
                                                                        }
                                                                    );
                                                                }
                                                            ),
                                                        res
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
