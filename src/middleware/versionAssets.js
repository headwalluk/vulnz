const fs = require('fs');
const { version } = require('../../package.json');

const htmlCache = {};

const versionAssets = (req, res, next, htmlPath) => {
  if (process.env.NODE_ENV === 'production' && htmlCache[htmlPath]) {
    return res.send(htmlCache[htmlPath]);
  }

  fs.readFile(htmlPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading HTML file:', err);
      return res.status(500).send('Error loading page');
    }

    const modifiedHtml = data.replace(/(href|src)="((?!.*?\/vendor\/).*?\.(css|js))"/g, `$1="$2?ver=${version}"`);
    if (process.env.NODE_ENV === 'production') {
      htmlCache[htmlPath] = modifiedHtml;
    }
    res.send(modifiedHtml);
  });
};

module.exports = { versionAssets };
