module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    jest: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // Since this is a newly added linter for an existing codebase, 
    // we set unused vars to warn to avoid breaking CI immediately
    'no-unused-vars': 'warn',
    'no-undef': 'error'
  }
};
