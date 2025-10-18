$(document).ready(function() {
    $('#register-form').on('submit', function(e) {
        e.preventDefault();

        const username = $('#username').val();
        const password = $('#password').val();
        const confirmPassword = $('#confirm-password').val();

        if (password !== confirmPassword) {
            $('#error-message').text('Passwords do not match.').show();
            return;
        }

        $.ajax({
            url: '/api/auth/register',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ username, password }),
            success: function() {
                window.location.href = '/login';
            },
            error: function(err) {
                $('#error-message').text(err.responseText).show();
            }
        });
    });
});
