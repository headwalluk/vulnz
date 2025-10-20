$(function () {
  $('#header-placeholder').load('/partials/header.html', function () {
    // Now that the header is loaded, check auth status and populate buttons
    $.ajax({
      url: '/api/auth/me',
      method: 'GET',
      success: function (data) {
        const headerButtons = $('#header-buttons');
        const flyInMenuItems = $('#fly-in-menu-items');
        headerButtons.empty();
        flyInMenuItems.empty();

        if (data.sitemap && data.sitemap.length > 0) {
          data.sitemap.forEach(function (item) {
            const button = $(`<a href="${item.url}" class="btn btn-sm ${item.type}">${item.text}</a>`);
            if (item.url === '/logout') {
              button.on('click', function (e) {
                e.preventDefault();
                $.ajax({
                  url: '/api/auth/logout',
                  method: 'GET',
                  success: function () {
                    window.location.href = '/';
                  },
                });
              });
            }
            headerButtons.append(button.clone(true));
            flyInMenuItems.append(button);
          });
          headerButtons.addClass('d-lg-flex');
        }
      },
      error: function () {
        const headerButtons = $('#header-buttons');
        const flyInMenuItems = $('#fly-in-menu-items');
        headerButtons.empty();
        flyInMenuItems.empty();
        headerButtons.append('<a href="/login" class="btn btn-sm btn-primary">Login</a>');
        headerButtons.addClass('d-lg-flex');
        flyInMenuItems.append('<a href="/login" class="btn btn-sm btn-primary">Login</a>');
      },
    });

    $(document).on('click', '#burger-menu', function () {
      $('#fly-in-menu').toggleClass('show');
    });

    $(document).on('click', '#close-menu', function () {
      $('#fly-in-menu').removeClass('show');
    });

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape' && $('#fly-in-menu').hasClass('show')) {
        $('#close-menu').trigger('click');
      }
    });
  });
  $('#footer-placeholder').load('/partials/footer.html');
});
