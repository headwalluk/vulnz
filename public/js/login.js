$(document).ready(function () {
  $.ajax({
    url: '/api/config',
    method: 'GET',
    success: function (config) {
      if (config.registrationEnabled) {
        $('#register-link').show();
      }
    },
  });
});
