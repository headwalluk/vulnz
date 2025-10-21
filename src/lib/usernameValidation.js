function validateUsername(username) {
  // This regex is a widely used pattern for email validation and allows for the "+" symbol.
  const emailRegex = new RegExp(
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  );
  const isValid = emailRegex.test(username);

  // Check we're validating email addresses correctly.
  process.env.LOG_LEVEL === 'debug' && console.log(`Validating username: ${username}, isValid: ${isValid}`);

  return {
    isValid: isValid,
    errors: isValid ? [] : ['Username must be a valid email address.'],
  };
}

module.exports = {
  validateUsername,
};
