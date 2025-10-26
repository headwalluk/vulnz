const setCacheControl = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const fileExtension = req.path.split('.').pop();
    const cacheableExtensions = ['css', 'js', 'woff', 'woff2', 'ttf', 'eot', 'svg'];
    if (cacheableExtensions.includes(fileExtension)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (['png', 'webp', 'jpg'].includes(fileExtension)) {
      res.set('Cache-Control', 'public, max-age=604800');
    }
  }
  next();
};

module.exports = { setCacheControl };
