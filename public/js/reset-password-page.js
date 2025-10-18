$(document).ready(function() {
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
