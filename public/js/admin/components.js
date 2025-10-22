$(document).ready(function () {
  let currentPage = 1;
  const limit = 10;
  let editComponentId = null;
  let totalPages = 1;

  // Check if the user is authenticated and an administrator
  $.ajax({
    url: '/api/auth/me',
    method: 'GET',
    success: function (user) {
      if (!user || !user.roles.includes('administrator')) {
        window.location.href = '/';
        return;
      }
      loadComponents(currentPage);
      loadComponentTypes();
    },
    error: function () {
      window.location.href = '/';
    },
  });

  $('#first-page').on('click', () => loadComponents(1));
  $('#prev-page').on('click', () => loadComponents(currentPage - 1));
  $('#next-page').on('click', () => loadComponents(currentPage + 1));
  $('#last-page').on('click', () => loadComponents(totalPages));
  $('#reload-page').on('click', () => loadComponents(currentPage));

  $('#create-component-form').on('submit', function (e) {
    e.preventDefault();
    const slug = $('#new-component-slug').val();
    const component_type_slug = $('#new-component-type-slug').val();
    const title = $('#new-component-title').val();
    const description = $('#new-component-description').val();

    const url = editComponentId ? `/api/components/${editComponentId}` : '/api/components';
    const method = editComponentId ? 'PUT' : 'POST';

    $.ajax({
      url,
      method,
      contentType: 'application/json',
      data: JSON.stringify({ slug, component_type_slug, title, description }),
      success: function () {
        resetComponentForm();
        loadComponents(currentPage);
      },
      error: function (err) {
        $('#error-message').text(err.responseText).show();
      },
    });
  });

  $('#new-component-btn').on('click', function () {
    resetComponentForm();
    $('#cancel-edit-component').show();
    $('#component-form-container').fadeIn();
    $('html, body').animate(
      {
        scrollTop: $('#component-form-container').offset().top,
      },
      500
    );
  });

  function loadComponentTypes() {
    $.ajax({
      url: '/api/component-types',
      method: 'GET',
      success: function (types) {
        const select = $('#new-component-type-slug');
        select.empty();
        types.forEach(function (type) {
          select.append(`<option value="${type.slug}">${type.title}</option>`);
        });
      },
    });
  }

  function loadComponents(page) {
    $('#component-list-spinner').show();
    $.ajax({
      url: `/api/components?page=${page}&limit=${limit}`,
      method: 'GET',
      success: function (data) {
        const { components, totalPages: newTotalPages } = data;
        totalPages = newTotalPages;
        currentPage = page;
        const componentsList = $('#components-list');
        componentsList.empty();

        if (components.length === 0) {
          return;
        }

        $('#component-page-count').text(`Page ${currentPage} of ${totalPages}`);
        $('#first-page').prop('disabled', currentPage === 1);
        $('#prev-page').prop('disabled', currentPage === 1);
        $('#next-page').prop('disabled', currentPage === totalPages);
        $('#last-page').prop('disabled', currentPage === totalPages);

        components.forEach(function (component) {
          let icon = '';
          if (component.component_type_slug === 'wordpress-plugin') {
            icon = '<i class="bi bi-puzzle-fill me-2"></i>';
          } else if (component.component_type_slug === 'wordpress-theme') {
            icon = '<i class="bi bi-palette-fill me-2"></i>';
          }
          componentsList.append(`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <span>
                                ${icon}
                                ${component.title}
                            </span>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm btn-warning" data-id="${component.id}"><i class="bi bi-pencil"></i></button>
                                <button class="btn btn-sm btn-danger" data-id="${component.id}"><i class="bi bi-trash"></i></button>
                            </div>
                        </li>
                    `);
        });
      },
      complete: function () {
        $('#component-list-spinner').hide();
      },
    });
  }

  $('#components-list').on('click', '.btn-danger', function () {
    const componentId = $(this).data('id');
    $.ajax({
      url: `/api/components/${componentId}`,
      method: 'DELETE',
      success: function () {
        loadComponents(currentPage);
      },
    });
  });

  $('#components-list').on('click', '.btn-warning', function () {
    const componentId = $(this).data('id');
    editComponentId = componentId;
    $.ajax({
      url: `/api/components/${componentId}`,
      method: 'GET',
      success: function (component) {
        $('#new-component-slug').val(component.slug);
        $('#new-component-type-slug').val(component.component_type_slug);
        $('#new-component-title').val(component.title);
        $('#new-component-description').val(component.description);
        $('#create-component-form h4').text('Edit Component');
        $('#create-component-form button[type="submit"]').text('Save Changes');
        $('#cancel-edit-component').show();
        $('#component-form-container').fadeIn();
        $('html, body').animate(
          {
            scrollTop: $('#component-form-container').offset().top,
          },
          500
        );
      },
    });
  });

  $('#cancel-edit-component').on('click', function () {
    resetComponentForm();
  });

  function resetComponentForm() {
    editComponentId = null;
    $('#create-component-form')[0].reset();
    $('#create-component-form h4').text('Create Component');
    $('#create-component-form button[type="submit"]').text('Create Component');
    $('#cancel-edit-component').hide();
    $('#component-form-container').hide();
  }
});
