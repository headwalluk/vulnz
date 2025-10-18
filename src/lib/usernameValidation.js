function validateUsername(username) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = emailRegex.test(username);

  return {
    isValid: isValid,
    errors: isValid ? [] : ['Username must be a valid email address.'],
  };
}

module.exports = {
  validateUsername,
};
