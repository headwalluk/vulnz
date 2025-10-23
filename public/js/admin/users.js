$(document).ready(function () {
  let currentPage = 1;
  const limit = 10;
  let totalPages = 1;
  let editUserId = null;
  let currentUser = null;
  let currentSearch = '';

  // Check if the user is authenticated and an administrator
  $.ajax({
    url: '/api/auth/me',
    method: 'GET',
    success: function (user) {
      if (!user || !user.roles.includes('administrator')) {
        window.location.href = '/';
        return;
      }
      currentUser = user;
      loadUsers(currentUser, 1);
      loadRoles();
    },
    error: function () {
      window.location.href = '/';
    },
  });

  $('#new-user-btn').on('click', function () {
    resetUserForm();
    $('#cancel-edit-user').show();
    $('#user-form-container').fadeIn();
    $('html, body').animate(
      {
        scrollTop: $('#user-form-container').offset().top,
      },
      500
    );
  });

  $('#create-user-form').on('submit', function (e) {
    e.preventDefault();
    const username = $('#new-username').val();
    const password = $('#new-user-password').val();
    const roles = [];
    $('#new-user-roles input:checked').each(function () {
      roles.push($(this).val());
    });
    const blocked = $('#new-user-blocked').is(':checked');
    const max_api_keys = $('#max-api-keys').val();
    const reporting_weekday = $('#reporting-weekday').val();

    const url = editUserId ? `/api/users/${editUserId}` : '/api/users';
    const method = editUserId ? 'PUT' : 'POST';

    $.ajax({
      url,
      method,
      contentType: 'application/json',
      data: JSON.stringify({
        username,
        password,
        roles,
        blocked,
        max_api_keys,
        reporting_weekday,
      }),
      success: function () {
        resetUserForm();
        loadUsers(currentUser, currentPage);
      },
      error: function (err) {
        alert(err.responseText);
      },
    });
  });

  $('#generate-password-btn').on('click', () => {
    const password = generateStrongPassword();
    $('#new-user-password').val(password);
  });

  function generateStrongPassword() {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    let password = '';
    password += upper[Math.floor(Math.random() * upper.length)];
    password += lower[Math.floor(Math.random() * lower.length)];
    password += lower[Math.floor(Math.random() * lower.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];

    const allChars = upper + lower + numbers + symbols;
    while (password.length < 12) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    return password
      .split('')
      .sort(() => 0.5 - Math.random())
      .join('');
  }

  function loadUsers(currentUser, page, search = '') {
    $('#user-list-spinner').show();
    let url = `/api/users?page=${page}&limit=${limit}`;
    if (search) {
      url += `&q=${encodeURIComponent(search)}`;
    }
    $.ajax({
      url,
      method: 'GET',
      success: function (data) {
        const { users, totalPages: newTotalPages } = data;
        totalPages = newTotalPages;
        currentPage = page;
        const usersList = $('#users-list');
        usersList.empty();
        if (users.length === 0) {
          if (currentSearch) {
            usersList.append('<div class="alert alert-info">No users found matching your search.</div>');
          } else {
            usersList.append('<div class="alert alert-info">No users found.</div>');
          }
        } else {
          users.forEach(function (user) {
            const deleteButton = currentUser.id === user.id ? '' : `<button class="btn btn-sm btn-danger" data-id="${user.id}">Delete</button>`;
            const blockedIcon = user.blocked ? '<i class="bi bi-slash-circle-fill text-danger ms-2"></i>' : '';
            const reportingDay = user.reporting_weekday ? `<span class="badge bg-info ms-2">${user.reporting_weekday}</span>` : '';
            usersList.append(`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                              <i class="bi bi-person-circle me-2 fs-4"></i>
                            </div>
                            <div class="flex-grow-1">
                                <span class="fw-medium">${user.username}</span>${blockedIcon}${reportingDay}<br/>
                                <span class="badge bg-secondary">id = ${user.id}</span>
                            </div>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm btn-warning" data-id="${user.id}"><i class="bi bi-pencil"></i></button>
                                ${deleteButton.replace('Delete', '<i class="bi bi-trash"></i>')}
                            </div>
                        </li>
                    `);
          });
        }
        $('#user-toolbar').show();
        if (totalPages > 0) {
          $('#user-page-count').text(`Page ${currentPage} of ${totalPages}`).show();
        } else {
          $('#user-page-count').hide();
        }
        const noPages = totalPages === 0;
        $('#first-page').prop('disabled', currentPage === 1 || noPages);
        $('#prev-page').prop('disabled', currentPage === 1 || noPages);
        $('#next-page').prop('disabled', currentPage === totalPages || noPages);
        $('#last-page').prop('disabled', currentPage === totalPages || noPages);
      },
      complete: function () {
        $('#user-list-spinner').hide();
      },
    });
  }

  $('#users-list').on('click', '.btn-warning', function () {
    const userId = $(this).data('id');
    editUserId = userId;
    $.ajax({
      url: `/api/users/${userId}`,
      method: 'GET',
      success: function (user) {
        $('#new-username').val(user.username);
        $('#max-api-keys').val(user.max_api_keys);
        $('#reporting-weekday').val(user.reporting_weekday);
        $('#create-user-form h4').text('Edit User');
        $('#create-user-form button[type="submit"]').text('Save Changes');
        $('#cancel-edit-user').show();
        $('#new-user-password').prop('required', false);
        $('#new-user-blocked').prop('checked', user.blocked);
        $('#user-form-container').fadeIn();
        $('html, body').animate(
          {
            scrollTop: $('#user-form-container').offset().top,
          },
          500
        );

        $('#new-user-roles input').each(function () {
          $(this).prop('checked', user.roles.includes($(this).val()));
        });
      },
      error: function (err) {
        alert('Failed to load user data.');
        console.error(err);
      },
    });
  });

  $('#cancel-edit-user').on('click', function () {
    resetUserForm();
  });

  function resetUserForm() {
    editUserId = null;
    $('#create-user-form')[0].reset();
    $('#create-user-form h4').text('Create User');
    $('#create-user-form button[type="submit"]').text('Create User');
    $('#cancel-edit-user').hide();
    $('#new-user-password').prop('required', true);
    $('#user-form-container').hide();
    $('#new-user-roles input').each(function () {
      $(this).prop('checked', $(this).val() === 'user');
    });
  }

  $('#users-list').on('click', '.btn-danger', function () {
    const userId = $(this).data('id');
    if (confirm('Are you sure you want to delete this user?')) {
      $.ajax({
        url: `/api/users/${userId}`,
        method: 'DELETE',
        success: function () {
          loadUsers(currentUser, currentPage);
        },
      });
    }
  });

  $('#user-search-form').on('submit', function (e) {
    e.preventDefault();
    const searchTerm = $('#user-search-input').val();
    currentSearch = searchTerm;
    loadUsers(currentUser, 1, searchTerm);
  });

  $('#user-search-input').on('input', function () {
    if ($(this).val() === '') {
      currentSearch = '';
      loadUsers(currentUser, 1, '');
    }
  });

  $('#first-page').on('click', () => loadUsers(currentUser, 1, currentSearch));
  $('#prev-page').on('click', () => loadUsers(currentUser, currentPage - 1, currentSearch));
  $('#next-page').on('click', () => loadUsers(currentUser, currentPage + 1, currentSearch));
  $('#last-page').on('click', () => loadUsers(currentUser, totalPages, currentSearch));
  $('#reload-page')
    .on('click', () => loadUsers(currentUser, currentPage, currentSearch))
    .tooltip();

  function loadRoles() {
    $.ajax({
      url: '/api/roles',
      method: 'GET',
      success: function (roles) {
        const container = $('#new-user-roles');
        container.empty();
        roles.forEach(function (role) {
          const div = $('<div class="form-check"></div>');
          const input = $(`<input class="form-check-input" type="checkbox" value="${role.name}" id="role-${role.name}">`);
          const label = $(`<label class="form-check-label" for="role-${role.name}">${role.name}</label>`);
          if (role.name === 'user') {
            input.prop('checked', true);
            input.prop('disabled', true);
          }
          div.append(input);
          div.append(label);
          container.append(div);
        });
      },
    });
  }
});
