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

  $('#component-pagination').on('click', '.page-link', function (e) {
    e.preventDefault();
    const page = $(this).data('page');
    if (page !== currentPage) {
      currentPage = page;
      loadComponents(currentPage);
    }
  });

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
    $.ajax({
      url: `/api/components?page=${page}&limit=${limit}`,
      method: 'GET',
      success: function (data) {
        const { components, total, page: currentPage, limit } = data;
        totalPages = Math.ceil(total / limit);
        const componentsList = $('#components-list');
        componentsList.empty();

        const pagination = $('#component-pagination');
        pagination.empty();

        if (totalPages > 1) {
          const firstDisabled = currentPage === 1 ? 'disabled' : '';
          pagination.append(`<li class="page-item ${firstDisabled}"><a class="page-link" href="#" data-page="1"><i class="bi bi-chevron-bar-left"></i></a></li>`);

          const prevDisabled = currentPage === 1 ? 'disabled' : '';
          pagination.append(`<li class="page-item ${prevDisabled}"><a class="page-link" href="#" data-page="${currentPage - 1}"><i class="bi bi-chevron-left"></i></a></li>`);

          pagination.append(`<li class="page-item disabled"><span class="page-link">Page ${currentPage} of ${totalPages}</span></li>`);

          const nextDisabled = currentPage === totalPages ? 'disabled' : '';
          pagination.append(`<li class="page-item ${nextDisabled}"><a class="page-link" href="#" data-page="${currentPage + 1}"><i class="bi bi-chevron-right"></i></a></li>`);

          const lastDisabled = currentPage === totalPages ? 'disabled' : '';
          pagination.append(`<li class="page-item ${lastDisabled}"><a class="page-link" href="#" data-page="${totalPages}"><i class="bi bi-chevron-bar-right"></i></a></li>`);
        }

        if (components.length === 0) {
          return;
        }

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
    });
  }

  $('#components-list').on('click', '.btn-danger', function () {
    const componentId = $(this).data('id');
    $.ajax({
      url: `/api/components/${componentId}`,
      method: 'DELETE',
      success: function () {
        loadComponents();
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
