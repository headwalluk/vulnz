$(document).ready(function() {
    $.ajax({
        url: '/api/config',
        method: 'GET',
        success: function(config) {
            $('#loading-spinner').hide();
            $('#main-card').show();
            if (config.registrationEnabled === 'false') {
                $('#registration-container').hide();
                $('#registration-disabled-message').show();
            }
        },
        error: function() {
            // Fallback: hide spinner and show the form even if config fails
            $('#loading-spinner').hide();
            $('#main-card').show();
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
