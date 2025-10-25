function redirectHtml(req, res, next) {
  if (req.path.endsWith('.html')) {
    if (req.path.startsWith('/partials/') || req.path.startsWith('/vendor/')) {
      return next();
    }
    const newPath = req.path.slice(0, -5);
    return res.redirect(301, newPath);
  }
  next();
}

module.exports = redirectHtml;
