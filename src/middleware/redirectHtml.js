function redirectHtml(req, res, next) {
  if (req.path.endsWith('.html')) {
    if (req.path.startsWith('/partials/') || req.path.startsWith('/vendor/')) {
      return next();
    }
    // Special-case index.html so we redirect to the directory root
    // Examples:
    //   /index.html        -> /
    //   /admin/index.html  -> /admin
    //   /foo/bar/index.html -> /foo/bar
    let newPath;
    if (/\/index\.html$/i.test(req.path)) {
      newPath = req.path.replace(/\/index\.html$/i, '');
      if (newPath === '') newPath = '/';
    } else {
      newPath = req.path.slice(0, -5); // strip trailing .html
    }

    // Preserve query string if present
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex !== -1 ? req.originalUrl.slice(queryIndex) : '';
    return res.redirect(301, newPath + query);
  }
  next();
}

module.exports = redirectHtml;
