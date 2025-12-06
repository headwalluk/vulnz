const maxmind = require('maxmind');
const path = require('path');

let cityLookup = null;
let countryLookup = null;

async function initializeGeoIP() {
  try {
    const geoipPath = process.env.GEOIP_DATABASE_PATH || '/var/lib/GeoIP';
    
    // Try to load City database (includes country data)
    const cityDbPath = path.join(geoipPath, 'GeoLite2-City.mmdb');
    try {
      cityLookup = await maxmind.open(cityDbPath);
      console.log('GeoIP City database loaded successfully');
      return;
    } catch (err) {
      console.warn('GeoIP City database not found, trying Country database');
    }

    // Fallback to Country database
    const countryDbPath = path.join(geoipPath, 'GeoLite2-Country.mmdb');
    try {
      countryLookup = await maxmind.open(countryDbPath);
      console.log('GeoIP Country database loaded successfully');
      return;
    } catch (err) {
      console.warn('GeoIP Country database not found');
    }

    console.warn('No GeoIP database found. Geographic lookups will be disabled.');
    console.warn(`Looked in: ${geoipPath}`);
    console.warn('To enable GeoIP, set GEOIP_DATABASE_PATH in .env and ensure GeoLite2 databases are present.');
  } catch (err) {
    console.error('Error initializing GeoIP:', err.message);
  }
}

function lookupIp(ip) {
  if (!cityLookup && !countryLookup) {
    return { continentCode: null, countryCode: null };
  }

  try {
    const lookup = cityLookup || countryLookup;
    const result = lookup.get(ip);

    if (!result) {
      return { continentCode: null, countryCode: null };
    }

    return {
      continentCode: result.continent?.code || null,
      countryCode: result.country?.iso_code || null
    };
  } catch (err) {
    console.error('GeoIP lookup error:', err.message);
    return { continentCode: null, countryCode: null };
  }
}

module.exports = {
  initializeGeoIP,
  lookupIp
};
