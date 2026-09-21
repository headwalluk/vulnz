const { getPasswordPolicy } = require('./env');

/** Check a password against the configured policy, returning every rule it breaks. */
function validatePassword(password) {
  const { minLength, minAlpha, minSymbols, minNumeric, minUppercase, minLowercase } = getPasswordPolicy();

  const errors = [];

  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long.`);
  }

  const alphaCount = (password.match(/[a-zA-Z]/g) || []).length;
  if (alphaCount < minAlpha) {
    errors.push(`Password must contain at least ${minAlpha} alphabetic characters.`);
  }

  const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;
  if (symbolCount < minSymbols) {
    errors.push(`Password must contain at least ${minSymbols} symbols.`);
  }

  const numericCount = (password.match(/[0-9]/g) || []).length;
  if (numericCount < minNumeric) {
    errors.push(`Password must contain at least ${minNumeric} numbers.`);
  }

  const uppercaseCount = (password.match(/[A-Z]/g) || []).length;
  if (uppercaseCount < minUppercase) {
    errors.push(`Password must contain at least ${minUppercase} uppercase letters.`);
  }

  const lowercaseCount = (password.match(/[a-z]/g) || []).length;
  if (lowercaseCount < minLowercase) {
    errors.push(`Password must contain at least ${minLowercase} lowercase letters.`);
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
  };
}

module.exports = {
  validatePassword,
};
