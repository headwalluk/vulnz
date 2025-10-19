$(document).ready(function() {
    let currentPage = 1;
    const limit = 10;
    let editUserId = null;
    let currentUser = null;

    // Check if the user is authenticated and an administrator
    $.ajax({
        url: '/api/auth/me',
        method: 'GET',
        success: function(user) {
            if (!user || !user.roles.includes('administrator')) {
                window.location.href = '/';
                return;
            }
            currentUser = user;
            loadUsers(currentUser, 1);
            loadRoles();
        },
        error: function() {
            window.location.href = '/';
        }
    });

    $('#new-user-btn').on('click', function() {
        resetUserForm();
        $('#cancel-edit-user').show();
        $('#user-form-container').fadeIn();
        $('html, body').animate({
            scrollTop: $("#user-form-container").offset().top
        }, 500);
    });

    $('#create-user-form').on('submit', function(e) {
        e.preventDefault();
        const username = $('#new-username').val();
        const password = $('#new-user-password').val();
        const roles = [];
        $('#new-user-roles input:checked').each(function() {
            roles.push($(this).val());
        });
        const blocked = $('#new-user-blocked').is(':checked');
        const max_api_keys = $('#max-api-keys').val();

        const url = editUserId ? `/api/users/${editUserId}` : '/api/users';
        const method = editUserId ? 'PUT' : 'POST';

        $.ajax({
            url,
            method,
            contentType: 'application/json',
            data: JSON.stringify({ username, password, roles, blocked, max_api_keys }),
            success: function() {
                resetUserForm();
                loadUsers(currentUser, currentPage);
            },
            error: function(err) {
                $('#error-message').text(err.responseText).show();
            }
        });
    });

    function loadUsers(currentUser, page) {
        $.ajax({
            url: `/api/users?page=${page}&limit=${limit}`,
            method: 'GET',
            success: function(data) {
                const { users, total } = data;
                const usersList = $('#users-list');
                usersList.empty();
                users.forEach(function(user) {
                    const deleteButton = currentUser.id === user.id ? '' : `<button class="btn btn-sm btn-danger" data-id="${user.id}">Delete</button>`;
                    const blockedIcon = user.blocked ? '<i class="bi bi-slash-circle-fill text-danger ms-2"></i>' : '';
                    usersList.append(`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <i class="bi bi-person-circle me-2"></i>
                                ${user.username}
                                ${blockedIcon}
                            </div>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm btn-warning" data-id="${user.id}"><i class="bi bi-pencil"></i></button>
                                ${deleteButton.replace('Delete', '<i class="bi bi-trash"></i>')}
                            </div>
                        </li>
                    `);
                });
            }
        });
    }

    $('#users-list').on('click', '.btn-warning', function() {
        const userId = $(this).data('id');
        editUserId = userId;
        $.ajax({
            url: `/api/users/${userId}`,
            method: 'GET',
            success: function(user) {
                $('#new-username').val(user.username);
                $('#max-api-keys').val(user.max_api_keys);
                $('#create-user-form h4').text('Edit User');
                $('#create-user-form button[type="submit"]').text('Save Changes');
                $('#cancel-edit-user').show();
                $('#new-user-password').prop('required', false);
                $('#new-user-blocked').prop('checked', user.blocked);
                $('#user-form-container').fadeIn();
                $('html, body').animate({
                    scrollTop: $("#user-form-container").offset().top
                }, 500);

                $('#new-user-roles input').each(function() {
                    $(this).prop('checked', user.roles.includes($(this).val()));
                });
            }
        });
    });

    $('#cancel-edit-user').on('click', function() {
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
        $('#new-user-roles input').each(function() {
            $(this).prop('checked', $(this).val() === 'user');
        });
    }

    $('#users-list').on('click', '.btn-danger', function() {
        const userId = $(this).data('id');
        if (confirm('Are you sure you want to delete this user?')) {
            $.ajax({
                url: `/api/users/${userId}`,
                method: 'DELETE',
                success: function() {
                    loadUsers(currentUser, currentPage);
                }
            });
        }
    });

    function loadRoles() {
        $.ajax({
            url: '/api/roles',
            method: 'GET',
            success: function(roles) {
                const container = $('#new-user-roles');
                container.empty();
                roles.forEach(function(role) {
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
            }
        });
    }
});
