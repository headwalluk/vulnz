$(document).ready(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const message = $('#message');
  const headerSpinner = $('#header-spinner');

  if (token) {
    headerSpinner.show();
    $.ajax({
      url: `/api/auth/validate-token/${token}`,
      method: 'GET',
      success: function () {
        $('#request-form-container').hide();
        $('#reset-password-form').show();
        $('#reset-token').val(token);
      },
      error: function (err) {
        message.text(err.responseText).addClass('alert-danger').show();
        $('#request-form-container').show();
        $('#reset-password-form').hide();
      },
      complete: function () {
        headerSpinner.hide();
      },
    });
  }

  $('#forgot-password-form').on('submit', function (e) {
    e.preventDefault();

    const email = $('#email').val();
    const button = $(this).find('button[type="submit"]');

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      message.text('Please enter a valid email address.').addClass('alert-danger').show();
      return;
    }

    headerSpinner.show();
    button.prop('disabled', true);
    message.hide();

    $.ajax({
      url: '/api/auth/reset-password',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ email }),
      success: function (response) {
        message.text(response).removeClass('alert-danger').addClass('alert-success').show();
      },
      error: function (err) {
        message.text(err.responseText).removeClass('alert-success').addClass('alert-danger').show();
      },
      complete: function () {
        headerSpinner.hide();
        button.prop('disabled', false);
      },
    });
  });

  $('#reset-password-form').on('submit', function (e) {
    e.preventDefault();

    const token = $('#reset-token').val();
    const newPassword = $('#new-password').val();
    const confirmPassword = $('#confirm-password').val();
    const button = $(this).find('button[type="submit"]');

    if (newPassword !== confirmPassword) {
      message.text('Passwords do not match.').addClass('alert-danger').show();
      return;
    }

    headerSpinner.show();
    button.prop('disabled', true);
    message.hide();

    $.ajax({
      url: '/api/auth/update-password',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ token, newPassword }),
      success: function (response) {
        message.text(response).removeClass('alert-danger').addClass('alert-success').show();
        setTimeout(() => (window.location.href = '/login'), 2000);
      },
      error: function (err) {
        message.text(err.responseText).removeClass('alert-success').addClass('alert-danger').show();
      },
      complete: function () {
        headerSpinner.hide();
        button.prop('disabled', false);
      },
    });
  });
});
