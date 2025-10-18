$(document).ready(function() {
    $.ajax({
        url: '/api/config',
        method: 'GET',
        success: function(config) {
            if (config.registrationEnabled !== 'false') {
                $('#register-link').show();
            }
        }
    });
    $.ajax({
        url: '/api/auth/me',
        method: 'GET',
        success: function(user) {
            if (user) {
                window.location.href = '/dashboard';
            }
        }
    });
});
