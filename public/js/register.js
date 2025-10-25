$(document).ready(function () {
  $('#register-form').on('submit', function (e) {
    e.preventDefault();

    const username = $('#username').val();
    const password = $('#password').val();
    const confirmPassword = $('#confirm-password').val();

    if (password !== confirmPassword) {
      $('#error-message').text('Passwords do not match.').show();
      return;
    }

    $('#header-spinner').show();
    $.ajax({
      url: '/api/auth/register',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ username, password }),
      success: function () {
        $('#register-form').hide();
        $('#error-message').hide();
        $('#success-message').html('Registration successful. Please <a href="/login">login</a>.').show();
      },
      error: function (err) {
        $('#error-message').text(err.responseText).show();
      },
      complete: function () {
        $('#header-spinner').hide();
      },
    });
  });
});
