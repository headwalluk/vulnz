$(document).ready(function() {
    const websitesList = $('#websites-list');
    const websiteFormContainer = $('#website-form-container');
    const createWebsiteForm = $('#create-website-form');
    const newWebsiteBtn = $('#new-website-btn');
    const cancelEditBtn = $('#cancel-edit-website');
    const userSelectContainer = $('#user-select-container');
    const userSelect = $('#user-select');

    let editMode = false;
    let editWebsiteId = null;

    function fetchWebsites() {
        $.ajax({
            url: '/api/websites',
            method: 'GET',
            success: function(data) {
                websitesList.empty();
                data.forEach(function(website) {
                    const username = website.username ? ` (${website.username})` : '';
                    websitesList.append(`
                        <li class="list-group-item d-flex justify-content-between align-items-center" data-id="${website.id}" data-user-id="${website.user_id}">
                            <span>${website.title} (${website.url})${username}</span>
                            <div>
                                <button class="btn btn-sm btn-warning edit-website-btn">Edit</button>
                                <button class="btn btn-sm btn-danger delete-website-btn">Delete</button>
                            </div>
                        </li>
                    `);
                });
            }
        });
    }

    newWebsiteBtn.on('click', function() {
        editMode = false;
        editWebsiteId = null;
        createWebsiteForm.find('h4').text('Create Website');
        createWebsiteForm.find('button[type="submit"]').text('Create Website');
        createWebsiteForm[0].reset();
        websiteFormContainer.show();
        cancelEditBtn.hide();
    });

    cancelEditBtn.on('click', function() {
        websiteFormContainer.hide();
    });

    function fetchUsers() {
        $.ajax({
            url: '/api/users',
            method: 'GET',
            success: function(data) {
                userSelect.empty();
                data.forEach(function(user) {
                    userSelect.append(`<option value="${user.id}">${user.username}</option>`);
                });
            }
        });
    }

    createWebsiteForm.on('submit', function(e) {
        e.preventDefault();
        const url = $('#new-url').val();
        const title = $('#new-title').val();
        const userId = userSelect.val();

        const method = editMode ? 'PUT' : 'POST';
        const apiUrl = editMode ? `/api/websites/${editWebsiteId}` : '/api/websites';

        const data = { url, title };
        if (userSelectContainer.is(':visible')) {
            data.user_id = userId;
        }

        $.ajax({
            url: apiUrl,
            method: method,
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function() {
                fetchWebsites();
                websiteFormContainer.hide();
            }
        });
    });

    websitesList.on('click', '.edit-website-btn', function() {
        const listItem = $(this).closest('li');
        editMode = true;
        editWebsiteId = listItem.data('id');
        const userId = listItem.data('user-id');

        const websiteText = listItem.find('span').text();
        const [title, url] = websiteText.match(/(.*) \((.*)\)/).slice(1);

        $('#new-url').val(url);
        $('#new-title').val(title);
        userSelect.val(userId);

        createWebsiteForm.find('h4').text('Edit Website');
        createWebsiteForm.find('button[type="submit"]').text('Update Website');
        websiteFormContainer.show();
        cancelEditBtn.show();
    });

    websitesList.on('click', '.delete-website-btn', function() {
        const websiteId = $(this).closest('li').data('id');
        if (confirm('Are you sure you want to delete this website?')) {
            $.ajax({
                url: `/api/websites/${websiteId}`,
                method: 'DELETE',
                success: function() {
                    fetchWebsites();
                }
            });
        }
    });

    $.ajax({
        url: '/api/auth/me',
        method: 'GET',
        success: function(data) {
            if (data.roles.includes('administrator')) {
                userSelectContainer.show();
                fetchUsers();
            }
        }
    });

    fetchWebsites();
});
