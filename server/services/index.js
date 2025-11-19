/**
 * Services Index
 * Exports all service modules for easy importing
 */

const notesService = require('./notesService');
const authService = require('./authService');
const adminService = require('./adminService');
const friendsService = require('./friendsService');
const aiService = require('./aiService');

module.exports = {
  notesService,
  authService,
  adminService,
  friendsService,
  aiService,
};
