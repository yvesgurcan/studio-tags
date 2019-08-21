module.exports = function(requireDirectory) {
    requireDirectory(module, {
        recurse: false,
        visit: file => file()
    });
};
