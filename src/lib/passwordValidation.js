require('dotenv').config();

function validatePassword(password) {
  const minLength = parseInt(process.env.PASSWORD_MIN_LENGTH, 10);
  const minAlpha = parseInt(process.env.PASSWORD_MIN_ALPHA, 10);
  const minSymbols = parseInt(process.env.PASSWORD_MIN_SYMBOLS, 10);
  const minNumeric = parseInt(process.env.PASSWORD_MIN_NUMERIC, 10);
  const minUppercase = parseInt(process.env.PASSWORD_MIN_UPPERCASE, 10);
  const minLowercase = parseInt(process.env.PASSWORD_MIN_LOWERCASE, 10);

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
