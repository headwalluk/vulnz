$(document).ready(function () {
  $('#login-form').on('submit', function (e) {
    e.preventDefault();

    const username = $('#username').val();
    const password = $('#password').val();

    $.ajax({
      url: '/api/auth/login',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ username, password }),
      success: function () {
        window.location.href = '/dashboard';
      },
      error: function (err) {
        const errorMessage = err.responseJSON ? err.responseJSON.message : 'An unknown error occurred.';
        $('#error-message').text(errorMessage).show();
      },
    });
  });
});
