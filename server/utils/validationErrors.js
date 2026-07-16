function publicValidationErrors(validationResult) {
  return validationResult.array().map(({ type, msg, path, location }) => ({
    type,
    msg,
    path,
    location
  }));
}

module.exports = { publicValidationErrors };
