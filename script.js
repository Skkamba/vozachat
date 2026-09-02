/* =========================================================
   VOZACHAT - COMPLETE FRONTEND SCRIPT
   Matches the current index.html
   Does NOT modify the database
   ========================================================= */


/* =========================================================
   GLOBAL ELEMENTS
   ========================================================= */

const tabs = document.querySelectorAll(".tab");
const sections = document.querySelectorAll(".section");

const discoverButton = document.getElementById("discoverButton");
const meButton = document.getElementById("meButton");
const findPeopleButton = document.getElementById("findPeopleButton");

const backButton = document.getElementById("backButton");
const chatBackButton = document.getElementById("chatBackButton");

const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messages = document.getElementById("messages");

const chatList = document.getElementById("chatList");
const emptyChats = document.getElementById("emptyChats");

const accountSection = document.getElementById("account");

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const otpForm = document.getElementById("otpForm");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const resetPasswordForm = document.getElementById("resetPasswordForm");

const showRegisterButton = document.getElementById("showRegisterButton");
const showLoginButton = document.getElementById("showLoginButton");
const forgotPasswordButton = document.getElementById("forgotPasswordButton");
const backToLoginButton = document.getElementById("backToLoginButton");


/* =========================================================
   APPLICATION DATA
   ========================================================= */

let users = [];
let currentUser = null;
let currentChatUsername = null;

let pendingRegistrationUserId =
    localStorage.getItem("vozachatPendingUserId") || null;

let pendingRegistrationUsername =
    localStorage.getItem("vozachatPendingUsername") || null;


/* =========================================================
   SAFE HTML
   ========================================================= */

function escapeHTML(value) {
    const div = document.createElement("div");

    div.textContent =
        value === null || value === undefined
            ? ""
            : String(value);

    return div.innerHTML;
}


/* =========================================================
   THEME
   ========================================================= */

function applyTheme(theme) {
    if (theme === "light") {
        document.body.classList.add("light-mode");
    } else {
        document.body.classList.remove("light-mode");
    }
}


function loadSavedTheme() {
    const theme =
        localStorage.getItem("vozachatTheme") || "dark";

    applyTheme(theme);
}


function saveTheme(theme) {
    localStorage.setItem("vozachatTheme", theme);
    applyTheme(theme);
}


/* =========================================================
   USER SESSION
   ========================================================= */

function loadSavedUser() {
    try {
        const saved =
            localStorage.getItem("vozachatUser");

        if (!saved) {
            currentUser = null;
            return;
        }

        const user = JSON.parse(saved);

        if (
            user &&
            user.id &&
            user.username
        ) {
            currentUser = user;
        } else {
            currentUser = null;
            localStorage.removeItem("vozachatUser");
        }

    } catch (error) {
        console.error("Could not restore user:", error);

        currentUser = null;

        localStorage.removeItem("vozachatUser");
    }
}


function isLoggedIn() {
    return Boolean(
        currentUser &&
        currentUser.id &&
        currentUser.username
    );
}


function saveCurrentUser() {
    if (!currentUser) {
        localStorage.removeItem("vozachatUser");
        return;
    }

    localStorage.setItem(
        "vozachatUser",
        JSON.stringify(currentUser)
    );
}


/* =========================================================
   SECTION NAVIGATION
   ========================================================= */

function hideAllSections() {
    sections.forEach(function(section) {
        section.classList.remove("active-section");
        section.style.display = "none";
    });
}


function showSection(sectionId) {
    hideAllSections();

    const section =
        document.getElementById(sectionId);

    if (!section) {
        console.error(
            "Section not found:",
            sectionId
        );
        return;
    }

    section.style.display = "block";
    section.classList.add("active-section");
}


function activateTab(sectionName) {
    tabs.forEach(function(tab) {
        tab.classList.remove("active");

        if (
            tab.dataset.section === sectionName
        ) {
            tab.classList.add("active");
        }
    });
}


/* =========================================================
   MAIN TABS
   ========================================================= */

tabs.forEach(function(tab) {

    tab.addEventListener("click", async function() {

        const sectionName =
            tab.dataset.section;

        if (!sectionName) {
            return;
        }

        showSection(sectionName);
        activateTab(sectionName);

        if (
            sectionName === "chats" &&
            isLoggedIn()
        ) {
            await updateChatList();
        }

    });

});


/* =========================================================
   DISCOVER
   ========================================================= */

function openDiscover() {
    showSection("discover");
    activateTab("");
}


if (discoverButton) {
    discoverButton.addEventListener(
        "click",
        openDiscover
    );
}


if (findPeopleButton) {
    findPeopleButton.addEventListener(
        "click",
        openDiscover
    );
}


/* =========================================================
   BACK FROM DISCOVER
   ========================================================= */

if (backButton) {

    backButton.addEventListener(
        "click",
        async function() {

            showSection("chats");
            activateTab("chats");

            if (isLoggedIn()) {
                await updateChatList();
            }

        }
    );

}


/* =========================================================
   LOAD USERS
   ========================================================= */

async function loadUsers() {

    try {

        const response =
            await fetch("/api/users");

        if (!response.ok) {
            throw new Error(
                "Unable to load users"
            );
        }

        const data =
            await response.json();

        users =
            Array.isArray(data)
                ? data
                : data.users || [];

    } catch (error) {

        console.error(
            "Could not load users:",
            error
        );

        users = [];

    }
}


/* =========================================================
   SEARCH USERS
   ========================================================= */

if (searchInput) {

    searchInput.addEventListener(
        "input",
        function() {

            const search =
                searchInput.value
                    .toLowerCase()
                    .trim()
                    .replace(/^@/, "");

            if (!search) {

                searchResults.innerHTML = `
                    <p class="search-hint">
                        Search for someone using their username.
                    </p>
                `;

                return;
            }


            const matchingUsers =
                users.filter(function(user) {

                    const username =
                        user.username || "";

                    return username
                        .toLowerCase()
                        .includes(search);

                });


            if (
                matchingUsers.length === 0
            ) {

                searchResults.innerHTML = `
                    <p class="search-hint">
                        No VozaChat user found.
                    </p>
                `;

                return;
            }


            searchResults.innerHTML = "";


            matchingUsers.forEach(function(user) {

                if (
                    currentUser &&
                    String(user.id) ===
                    String(currentUser.id)
                ) {
                    return;
                }


                const name =
                    user.name ||
                    user.full_name ||
                    user.fullName ||
                    user.username ||
                    "VozaChat User";


                const firstLetter =
                    name
                        .charAt(0)
                        .toUpperCase();


                const card =
                    document.createElement("div");

                card.className =
                    "user-card";


                card.innerHTML = `
                    <div class="user-avatar">
                        ${escapeHTML(firstLetter)}
                    </div>

                    <div class="user-info">

                        <div class="user-name">
                            ${escapeHTML(name)}
                        </div>

                        <div class="user-username">
                            @${escapeHTML(user.username)}
                        </div>

                    </div>

                    <button
                        class="message-button"
                        type="button"
                    >
                        Message
                    </button>
                `;


                const messageButton =
                    card.querySelector(
                        ".message-button"
                    );


                messageButton.addEventListener(
                    "click",
                    function() {

                        startChat(
                            user.username,
                            name
                        );

                    }
                );


                searchResults.appendChild(card);

            });

        }
    );

}


/* =========================================================
   START CHAT
   ========================================================= */

async function startChat(username, name) {

    if (!isLoggedIn()) {

        alert(
            "Please log in to send messages."
        );

        return;
    }


    currentChatUsername =
        username;


    const chatName =
        document.getElementById("chatName");

    const chatAvatar =
        document.getElementById("chatAvatar");


    if (chatName) {
        chatName.textContent =
            name || username;
    }


    if (chatAvatar) {
        chatAvatar.textContent =
            (
                name ||
                username ||
                "U"
            )
            .charAt(0)
            .toUpperCase();
    }


    showSection("chat");


    await loadMessages(username);

}


/* =========================================================
   LOAD MESSAGES
   ========================================================= */

async function loadMessages(username) {

    if (!isLoggedIn()) {
        return;
    }


    if (!messages) {
        return;
    }


    messages.innerHTML = `
        <div class="chat-empty">
            Loading messages...
        </div>
    `;


    try {

        const response =
            await fetch(
                `/api/messages/${encodeURIComponent(
                    currentUser.id
                )}/${encodeURIComponent(
                    username
                )}`
            );


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.message ||
                "Unable to load messages"
            );

        }


        messages.innerHTML = "";


        const chatMessages =
            result.messages || [];


        if (
            chatMessages.length === 0
        ) {

            const empty =
                document.createElement("div");

            empty.className =
                "chat-empty";

            empty.textContent =
                "Start a conversation with " +
                username;

            messages.appendChild(empty);

            return;
        }


        chatMessages.forEach(function(message) {

            const messageElement =
                document.createElement("div");


            const senderId =
                message.sender_id ??
                message.senderId;


            if (
                String(senderId) ===
                String(currentUser.id)
            ) {

                messageElement.className =
                    "message sent";

            } else {

                messageElement.className =
                    "message received";

            }


            messageElement.textContent =
                message.message ||
                message.message_text ||
                "";


            messages.appendChild(
                messageElement
            );

        });


        messages.scrollTop =
            messages.scrollHeight;


    } catch (error) {

        console.error(
            "Could not load messages:",
            error
        );


        messages.innerHTML = `
            <div class="chat-empty">
                Unable to load messages.
            </div>
        `;

    }

}


/* =========================================================
   BACK FROM CHAT
   ========================================================= */

if (chatBackButton) {

    chatBackButton.addEventListener(
        "click",
        async function() {

            currentChatUsername = null;

            showSection("chats");
            activateTab("chats");

            if (isLoggedIn()) {
                await updateChatList();
            }

        }
    );

}


/* =========================================================
   SEND MESSAGE
   ========================================================= */

async function sendMessage() {

    if (!isLoggedIn()) {

        alert(
            "Please log in first."
        );

        return;
    }


    if (!currentChatUsername) {

        alert(
            "Please open a conversation first."
        );

        return;
    }


    if (!messageInput) {
        return;
    }


    const text =
        messageInput.value.trim();


    if (!text) {
        return;
    }


    if (sendButton) {
        sendButton.disabled = true;
    }


    try {

        const response =
            await fetch(
                "/api/messages",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        senderId:
                            currentUser.id,

                        receiverUsername:
                            currentChatUsername,

                        message:
                            text

                    })
                }
            );


        const result =
            await response.json();


        if (!response.ok) {

            alert(
                result.message ||
                "Unable to send message."
            );

            return;
        }


        messageInput.value = "";


        await loadMessages(
            currentChatUsername
        );


        await updateChatList();


    } catch (error) {

        console.error(
            "Send message error:",
            error
        );


        alert(
            "Could not connect to the VozaChat server."
        );

    } finally {

        if (sendButton) {
            sendButton.disabled = false;
        }

    }

}


if (sendButton) {

    sendButton.addEventListener(
        "click",
        sendMessage
    );

}


if (messageInput) {

    messageInput.addEventListener(
        "keydown",
        function(event) {

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                sendMessage();

            }

        }
    );

}


/* =========================================================
   CHAT LIST
   ========================================================= */

async function updateChatList() {

    if (!isLoggedIn()) {

        if (emptyChats) {
            emptyChats.style.display = "flex";
        }

        return;
    }


    try {

        const response =
            await fetch(
                `/api/chats/${encodeURIComponent(
                    currentUser.id
                )}`
            );


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.message ||
                "Unable to load chats"
            );

        }


        const chats =
            result.chats || [];


        if (
            chats.length === 0
        ) {

            if (emptyChats) {
                emptyChats.style.display =
                    "flex";
            }

            if (chatList) {
                chatList.innerHTML = "";
            }

            return;
        }


        if (emptyChats) {
            emptyChats.style.display =
                "none";
        }


        if (!chatList) {
            return;
        }


        chatList.innerHTML = "";


        chats.forEach(function(chat) {

            const name =
                chat.name ||
                chat.full_name ||
                chat.username ||
                "VozaChat User";


            const firstLetter =
                name
                    .charAt(0)
                    .toUpperCase();


            const item =
                document.createElement("div");


            item.className =
                "conversation-item";


            item.innerHTML = `
                <div class="conversation-avatar">
                    ${escapeHTML(firstLetter)}
                </div>

                <div class="conversation-info">

                    <div class="conversation-name">
                        ${escapeHTML(name)}
                    </div>

                    <div class="conversation-preview">
                        ${
                            chat.last_message
                                ? escapeHTML(
                                    chat.last_message
                                )
                                : "No messages yet"
                        }
                    </div>

                </div>
            `;


            item.addEventListener(
                "click",
                function() {

                    startChat(
                        chat.username,
                        name
                    );

                }
            );


            chatList.appendChild(item);

        });


    } catch (error) {

        console.error(
            "Could not load chats:",
            error
        );

    }

}


/* =========================================================
   ACCOUNT FORM HELPERS
   ========================================================= */

function hideAccountForms() {

    if (loginForm) {
        loginForm.style.display = "none";
    }

    if (registerForm) {
        registerForm.style.display = "none";
    }

    if (otpForm) {
        otpForm.style.display = "none";
    }

    if (forgotPasswordForm) {
        forgotPasswordForm.style.display = "none";
    }

    if (resetPasswordForm) {
        resetPasswordForm.style.display = "none";
    }

}


/* =========================================================
   SHOW LOGIN
   ========================================================= */

function showLogin() {

    hideAccountForms();


    if (!accountSection) {
        return;
    }


    hideAllSections();


    accountSection.style.display =
        "block";

    accountSection.classList.add(
        "active-section"
    );


    if (loginForm) {
        loginForm.style.display =
            "block";
    }

}


/* =========================================================
   SHOW REGISTER
   ========================================================= */

if (showRegisterButton) {

    showRegisterButton.addEventListener(
        "click",
        function() {

            hideAccountForms();

            if (registerForm) {
                registerForm.style.display =
                    "block";
            }

        }
    );

}


/* =========================================================
   SHOW LOGIN BUTTON
   ========================================================= */

if (showLoginButton) {

    showLoginButton.addEventListener(
        "click",
        showLogin
    );

}


/* =========================================================
   SHOW OTP
   ========================================================= */

function showOtp() {

    hideAccountForms();


    if (!accountSection) {
        return;
    }


    hideAllSections();


    accountSection.style.display =
        "block";

    accountSection.classList.add(
        "active-section"
    );


    if (otpForm) {
        otpForm.style.display =
            "block";
    }


    const otpMessage =
        document.getElementById(
            "otpMessage"
        );


    if (otpMessage) {

        otpMessage.textContent =
            "Enter the 6-digit verification code sent to you.";

    }

}


/* =========================================================
   ME / ACCOUNT
   ========================================================= */

if (meButton) {

    meButton.addEventListener(
        "click",
        function(event) {

            event.preventDefault();


            loadSavedUser();


            if (isLoggedIn()) {

                showAccountHome();

                return;

            }


            if (
                pendingRegistrationUserId
            ) {

                showOtp();

                return;

            }


            showLogin();

        }
    );

}


/* =========================================================
   ACCOUNT HOME
   ========================================================= */

function showAccountHome() {

    if (!accountSection) {
        return;
    }


    hideAccountForms();
    hideAllSections();


    accountSection.style.display =
        "block";

    accountSection.classList.add(
        "active-section"
    );


    if (!isLoggedIn()) {

        showLogin();

        return;

    }


    const name =
        currentUser.name ||
        currentUser.full_name ||
        "VozaChat User";


    const username =
        currentUser.username ||
        "";


    const email =
        currentUser.email ||
        "Not provided";


    const phone =
        currentUser.phone ||
        "Not provided";


    const country =
        currentUser.country ||
        "Not provided";


    const firstLetter =
        (
            name ||
            username ||
            "U"
        )
        .charAt(0)
        .toUpperCase();


    accountSection.innerHTML = `

        <div class="auth-container">

            <div class="auth-logo">
                VozaChat
            </div>

            <div class="profile-header">

                <div class="profile-avatar">
                    ${escapeHTML(firstLetter)}
                </div>

                <h1>
                    ${escapeHTML(name)}
                </h1>

                <p>
                    @${escapeHTML(username)}
                </p>

            </div>


            <div class="profile-details">

                <div class="profile-detail">
                    <strong>Email</strong>
                    <span>
                        ${escapeHTML(email)}
                    </span>
                </div>


                <div class="profile-detail">
                    <strong>Phone</strong>
                    <span>
                        ${escapeHTML(phone)}
                    </span>
                </div>


                <div class="profile-detail">
                    <strong>Country</strong>
                    <span>
                        ${escapeHTML(country)}
                    </span>
                </div>

            </div>


            <button
                class="primary-button"
                id="editProfileButton"
                type="button"
            >
                Edit profile
            </button>


            <button
                class="text-button"
                id="settingsButton"
                type="button"
            >
                Settings
            </button>


            <button
                class="text-button"
                id="logoutButton"
                type="button"
                style="color: var(--danger);"
            >
                Log out
            </button>

        </div>

    `;


    document
        .getElementById("editProfileButton")
        ?.addEventListener(
            "click",
            showEditProfile
        );


    document
        .getElementById("settingsButton")
        ?.addEventListener(
            "click",
            showSettings
        );


    document
        .getElementById("logoutButton")
        ?.addEventListener(
            "click",
            logoutUser
        );

}


/* =========================================================
   EDIT PROFILE
   ========================================================= */

function showEditProfile() {

    if (!isLoggedIn()) {

        showLogin();

        return;

    }


    hideAllSections();


    accountSection.style.display =
        "block";

    accountSection.classList.add(
        "active-section"
    );


    const name =
        currentUser.name ||
        currentUser.full_name ||
        "";


    const username =
        currentUser.username ||
        "";


    const email =
        currentUser.email ||
        "";


    const phone =
        currentUser.phone ||
        "";


    const country =
        currentUser.country ||
        "";


    const firstLetter =
        (
            name ||
            username ||
            "U"
        )
        .charAt(0)
        .toUpperCase();


    accountSection.innerHTML = `

        <div class="auth-container">

            <div class="discover-header">

                <button
                    class="back-button"
                    id="editProfileBackButton"
                    type="button"
                >
                    ←
                </button>

                <h2>
                    Edit profile
                </h2>

            </div>


            <div class="profile-edit-avatar">
                ${escapeHTML(firstLetter)}
            </div>


            <label>Full name</label>

            <input
                type="text"
                id="editProfileName"
                value="${escapeHTML(name)}"
                placeholder="Your full name"
            >


            <label>Username</label>

            <input
                type="text"
                id="editProfileUsername"
                value="@${escapeHTML(username)}"
                placeholder="@username"
            >


            <label>Email address</label>

            <input
                type="email"
                id="editProfileEmail"
                value="${escapeHTML(email)}"
                placeholder="you@example.com"
            >


            <label>Country</label>

            <select id="editProfileCountry">

                <option value="">
                    🌍 Select your country
                </option>

            </select>


            <label>Phone number</label>

            <input
                type="tel"
                id="editProfilePhone"
                value="${escapeHTML(phone)}"
                placeholder="Phone number"
            >


            <button
                class="primary-button"
                id="saveProfileButton"
                type="button"
            >
                Save changes
            </button>


            <button
                class="text-button"
                id="cancelEditProfileButton"
                type="button"
            >
                Cancel
            </button>

        </div>

    `;


    populateEditCountry(country);


    document
        .getElementById("editProfileBackButton")
        ?.addEventListener(
            "click",
            showAccountHome
        );


    document
        .getElementById("cancelEditProfileButton")
        ?.addEventListener(
            "click",
            showAccountHome
        );


    document
        .getElementById("saveProfileButton")
        ?.addEventListener(
            "click",
            saveEditedProfile
        );

}


/* =========================================================
   COUNTRY LIST FOR EDIT PROFILE
   ========================================================= */

function populateEditCountry(selectedCountry) {

    const select =
        document.getElementById(
            "editProfileCountry"
        );


    if (!select) {
        return;
    }


    if (
        typeof countryCodes === "undefined"
    ) {
        return;
    }


    const names =
        new Intl.DisplayNames(
            ["en"],
            {
                type: "region"
            }
        );


    countryCodes.forEach(function(code) {

        const option =
            document.createElement("option");


        option.value = code;


        option.textContent =
            code === "NG"
                ? "🇳🇬 Nigeria"
                : names.of(code);


        if (
            String(code).toUpperCase() ===
            String(selectedCountry).toUpperCase()
        ) {

            option.selected = true;

        }


        select.appendChild(option);

    });

}


/* =========================================================
   SAVE EDITED PROFILE
   ========================================================= */

function saveEditedProfile() {

    const nameInput =
        document.getElementById(
            "editProfileName"
        );

    const usernameInput =
        document.getElementById(
            "editProfileUsername"
        );

    const emailInput =
        document.getElementById(
            "editProfileEmail"
        );

    const countryInput =
        document.getElementById(
            "editProfileCountry"
        );

    const phoneInput =
        document.getElementById(
            "editProfilePhone"
        );


    const name =
        nameInput?.value.trim() || "";


    const username =
        usernameInput?.value
            .trim()
            .replace(/^@/, "") || "";


    const email =
        emailInput?.value.trim() || "";


    const country =
        countryInput?.value || "";


    const phone =
        phoneInput?.value.trim() || "";


    if (!name) {

        alert(
            "Please enter your full name."
        );

        return;

    }


    if (!username) {

        alert(
            "Please enter a username."
        );

        return;

    }


    if (
        !/^[a-zA-Z0-9_.]+$/.test(username)
    ) {

        alert(
            "Username can only contain letters, numbers, underscores and dots."
        );

        return;

    }


    if (!country) {

        alert(
            "Please select your country."
        );

        return;

    }


    if (!email && !phone) {

        alert(
            "Please provide an email address or phone number."
        );

        return;

    }


    if (
        email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {

        alert(
            "Please enter a valid email address."
        );

        return;

    }


    const duplicate =
        users.some(function(user) {

            return (
                String(user.id) !==
                String(currentUser.id) &&

                user.username &&
                user.username.toLowerCase() ===
                username.toLowerCase()
            );

        });


    if (duplicate) {

        alert(
            "That username is already in use."
        );

        return;

    }


    currentUser.name =
        name;

    currentUser.username =
        username;

    currentUser.email =
        email;

    currentUser.country =
        country;

    currentUser.phone =
        phone;


    saveCurrentUser();


    const existingUser =
        users.find(function(user) {

            return (
                String(user.id) ===
                String(currentUser.id)
            );

        });


    if (existingUser) {

        existingUser.name =
            name;

        existingUser.username =
            username;

        existingUser.email =
            email;

        existingUser.country =
            country;

        existingUser.phone =
            phone;

    }


    alert(
        "Your profile has been updated successfully."
    );


    showAccountHome();

}


/* =========================================================
   SETTINGS
   ========================================================= */

function showSettings() {

    hideAllSections();


    const settings =
        document.getElementById("settings");


    if (!settings) {
        return;
    }


    settings.style.display =
        "block";

    settings.classList.add(
        "active-section"
    );


    const back =
        document.getElementById(
            "settingsBackButton"
        );


    if (back) {

        back.onclick =
            showAccountHome;

    }


    const profileButton =
        document.getElementById(
            "settingsProfileButton"
        );


    if (profileButton) {

        profileButton.onclick =
            showEditProfile;

    }


    const privacyButton =
        document.getElementById(
            "settingsPrivacyButton"
        );


    if (privacyButton) {

        privacyButton.onclick =
            function() {

                alert(
                    "Privacy settings will be connected to the backend next."
                );

            };

    }


    const notificationsButton =
        document.getElementById(
            "notificationsButton"
        );


    if (notificationsButton) {

        notificationsButton.onclick =
            function() {

                alert(
                    "Notification settings will be added next."
                );

            };

    }


    const mediaButton =
        document.getElementById(
            "mediaButtonSettings"
        );


    if (mediaButton) {

        mediaButton.onclick =
            function() {

                alert(
                    "Media settings will be added next."
                );

            };

    }


    const languageButton =
        document.getElementById(
            "languageButton"
        );


    if (languageButton) {

        languageButton.onclick =
            function() {

                alert(
                    "Language settings will be added next."
                );

            };

    }


    const aboutButton =
        document.getElementById(
            "aboutButton"
        );


    if (aboutButton) {

        aboutButton.onclick =
            function() {

                alert(
                    "VozaChat version 1.0.0"
                );

            };

    }


    const logoutButton =
        document.getElementById(
            "settingsLogoutButton"
        );


    if (logoutButton) {

        logoutButton.onclick =
            logoutUser;

    }

}


/* =========================================================
   LOGOUT
   ========================================================= */

function logoutUser() {

    const confirmed =
        confirm(
            "Are you sure you want to log out of VozaChat?"
        );


    if (!confirmed) {
        return;
    }


    currentUser = null;
    currentChatUsername = null;


    localStorage.removeItem(
        "vozachatUser"
    );


    location.reload();

}


/* =========================================================
   REGISTER
   ========================================================= */

const registerButton =
    document.getElementById(
        "registerButton"
    );


if (registerButton) {

    registerButton.addEventListener(
        "click",
        async function() {

            const name =
                document.getElementById(
                    "registerName"
                )?.value.trim() || "";


            const username =
                document.getElementById(
                    "registerUsername"
                )?.value
                    .trim()
                    .replace(/^@/, "") || "";


            const email =
                document.getElementById(
                    "registerEmail"
                )?.value.trim() || "";


            const country =
                document.getElementById(
                    "registerCountry"
                )?.value || "";


            const phone =
                document.getElementById(
                    "registerPhone"
                )?.value.trim() || "";


            const password =
                document.getElementById(
                    "registerPassword"
                )?.value || "";


            const confirmPassword =
                document.getElementById(
                    "registerConfirmPassword"
                )?.value || "";


            if (
                !name ||
                !username ||
                !country ||
                !password ||
                !confirmPassword
            ) {

                alert(
                    "Please complete all required fields."
                );

                return;

            }


            if (!email && !phone) {

                alert(
                    "Enter an email address or phone number."
                );

                return;

            }


            if (
                password !==
                confirmPassword
            ) {

                alert(
                    "Passwords do not match."
                );

                return;

            }


            if (password.length < 8) {

                alert(
                    "Password must contain at least 8 characters."
                );

                return;

            }


            registerButton.disabled =
                true;

            registerButton.textContent =
                "Creating account...";


            try {

                const response =
                    await fetch(
                        "/api/register",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                name:
                                    name,

                                username:
                                    username,

                                email:
                                    email,

                                country:
                                    country,

                                phone:
                                    phone,

                                password:
                                    password

                            })
                        }
                    );


                const result =
                    await response.json();


                if (!response.ok) {

                    alert(
                        result.message ||
                        "Registration failed."
                    );

                    return;
                }


                pendingRegistrationUserId =
                    String(result.userId);


                pendingRegistrationUsername =
                    result.username ||
                    username;


                localStorage.setItem(
                    "vozachatPendingUserId",
                    pendingRegistrationUserId
                );


                localStorage.setItem(
                    "vozachatPendingUsername",
                    pendingRegistrationUsername
                );


                showOtp();


            } catch (error) {

                console.error(
                    "Registration error:",
                    error
                );


                alert(
                    "Could not connect to the VozaChat server."
                );

            } finally {

                registerButton.disabled =
                    false;

                registerButton.textContent =
                    "Create account";

            }

        }
    );

}


/* =========================================================
   VERIFY REGISTRATION OTP
   ========================================================= */

const verifyOtpButton =
    document.getElementById(
        "verifyOtpButton"
    );


if (verifyOtpButton) {

    verifyOtpButton.addEventListener(
        "click",
        async function() {

            const otp =
                document.getElementById(
                    "otpInput"
                )?.value.trim() || "";


            const userId =
                pendingRegistrationUserId ||
                localStorage.getItem(
                    "vozachatPendingUserId"
                );


            if (!userId) {

                alert(
                    "Registration session not found. Please create the account again."
                );

                return;

            }


            if (!/^\d{6}$/.test(otp)) {

                alert(
                    "Please enter the 6-digit OTP."
                );

                return;

            }


            verifyOtpButton.disabled =
                true;

            verifyOtpButton.textContent =
                "Verifying...";


            try {

                const response =
                    await fetch(
                        "/api/verify-registration",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                userId:
                                    Number(userId),

                                otp:
                                    otp

                            })
                        }
                    );


                const result =
                    await response.json();


                if (!response.ok) {

                    alert(
                        result.message ||
                        "OTP verification failed."
                    );

                    return;

                }


                currentUser =
                    result.user;


                saveCurrentUser();


                localStorage.removeItem(
                    "vozachatPendingUserId"
                );

                localStorage.removeItem(
                    "vozachatPendingUsername"
                );


                pendingRegistrationUserId =
                    null;

                pendingRegistrationUsername =
                    null;


                const otpInput =
                    document.getElementById(
                        "otpInput"
                    );


                if (otpInput) {
                    otpInput.value = "";
                }


                await loadUsers();


                alert(
                    "🎉 Your VozaChat account has been verified successfully!"
                );


                showSection("chats");
                activateTab("chats");


                await updateChatList();


            } catch (error) {

                console.error(
                    "OTP verification error:",
                    error
                );


                alert(
                    "Could not connect to the VozaChat server."
                );

            } finally {

                verifyOtpButton.disabled =
                    false;

                verifyOtpButton.textContent =
                    "Verify OTP";

            }

        }
    );

}


/* =========================================================
   RESEND OTP
   ========================================================= */

const resendOtpButton =
    document.getElementById(
        "resendOtpButton"
    );


if (resendOtpButton) {

    resendOtpButton.addEventListener(
        "click",
        async function() {

            const userId =
                pendingRegistrationUserId ||
                localStorage.getItem(
                    "vozachatPendingUserId"
                );


            if (!userId) {

                alert(
                    "Registration session not found."
                );

                return;

            }


            resendOtpButton.disabled =
                true;

            resendOtpButton.textContent =
                "Sending...";


            try {

                const response =
                    await fetch(
                        "/api/resend-registration-otp",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                userId:
                                    Number(userId)

                            })
                        }
                    );


                const result =
                    await response.json();


                if (!response.ok) {

                    alert(
                        result.message ||
                        "Unable to resend OTP."
                    );

                    return;

                }


                alert(
                    "A new verification code has been sent."
                );


            } catch (error) {

                console.error(
                    "Resend OTP error:",
                    error
                );


                alert(
                    "Could not connect to the VozaChat server."
                );

            } finally {

                resendOtpButton.disabled =
                    false;

                resendOtpButton.textContent =
                    "Resend code";

            }

        }
    );

}


/* =========================================================
   LOGIN
   ========================================================= */

const loginButton =
    document.getElementById(
        "loginButton"
    );


if (loginButton) {

    loginButton.addEventListener(
        "click",
        async function() {

            const identifier =
                document.getElementById(
                    "loginIdentifier"
                )?.value.trim() || "";


            const password =
                document.getElementById(
                    "loginPassword"
                )?.value || "";


            if (!identifier || !password) {

                alert(
                    "Enter your login details."
                );

                return;

            }


            loginButton.disabled =
                true;

            loginButton.textContent =
                "Logging in...";


            try {

                const response =
                    await fetch(
                        "/api/login",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                identifier:
                                    identifier,

                                password:
                                    password

                            })
                        }
                    );


                const result =
                    await response.json();


                if (!response.ok) {

                    alert(
                        result.message ||
                        "Login failed."
                    );

                    return;

                }


                currentUser =
                    result.user;


                saveCurrentUser();


                alert(
                    "Welcome to VozaChat, " +
                    (
                        result.user.name ||
                        result.user.username
                    ) +
                    "!"
                );


                await loadUsers();


                showSection("chats");
                activateTab("chats");


                await updateChatList();


            } catch (error) {

                console.error(
                    "Login error:",
                    error
                );


                alert(
                    "Could not connect to the VozaChat server."
                );

            } finally {

                loginButton.disabled =
                    false;

                loginButton.textContent =
                    "Log in";

            }

        }
    );

}


/* =========================================================
   FORGOT PASSWORD
   ========================================================= */

if (forgotPasswordButton) {

    forgotPasswordButton.addEventListener(
        "click",
        function() {

            hideAccountForms();

            if (forgotPasswordForm) {

                forgotPasswordForm.style.display =
                    "block";

            }

        }
    );

}


if (backToLoginButton) {

    backToLoginButton.addEventListener(
        "click",
        showLogin
    );

}


/* =========================================================
   SEND PASSWORD RESET OTP
   ========================================================= */

const sendResetOtpButton =
    document.getElementById(
        "sendResetOtpButton"
    );


if (sendResetOtpButton) {

    sendResetOtpButton.addEventListener(
        "click",
        async function() {

            const identifier =
                document.getElementById(
                    "forgotIdentifier"
                )?.value.trim() || "";


            if (!identifier) {

                alert(
                    "Enter your email or phone number."
                );

                return;

            }


            sendResetOtpButton.disabled =
                true;

            sendResetOtpButton.textContent =
                "Sending...";


            try {

                const response =
                    await fetch(
                        "/api/forgot-password",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                identifier:
                                    identifier
                            })
                        }
                    );


                const result =
                    await response.json();


                if (!response.ok) {

                    alert(
                        result.message ||
                        "Unable to send reset OTP."
                    );

                    return;

                }


                alert(
                    result.message ||
                    "Password reset OTP sent."
                );


                hideAccountForms();


                if (resetPasswordForm) {

                    resetPasswordForm.style.display =
                        "block";

                }


            } catch (error) {

                console.error(
                    "Password reset error:",
                    error
                );


                alert(
                    "Could not connect to the VozaChat server."
                );

            } finally {

                sendResetOtpButton.disabled =
                    false;

                sendResetOtpButton.textContent =
                    "Send OTP";

            }

        }
    );

}


/* =========================================================
   RESET PASSWORD
   ========================================================= */

const resetPasswordButton =
    document.getElementById(
        "resetPasswordButton"
    );


if (resetPasswordButton) {

    resetPasswordButton.addEventListener(
        "click",
        async function() {

            const otp =
                document.getElementById(
                    "resetOtp"
                )?.value.trim() || "";


            const password =
                document.getElementById(
                    "newPassword"
                )?.value || "";


            const confirmPassword =
                document.getElementById(
                    "confirmNewPassword"
                )?.value || "";


            const identifier =
                document.getElementById(
                    "forgotIdentifier"
                )?.value.trim() || "";


            if (
                !otp ||
                !password ||
                !confirmPassword
            ) {

                alert(
                    "Complete all fields."
                );

                return;

            }


            if (
                password !==
                confirmPassword
            ) {

                alert(
                    "Passwords do not match."
                );

                return;

            }


            if (password.length < 8) {

                alert(
                    "Password must contain at least 8 characters."
                );

                return;

            }


            resetPasswordButton.disabled =
                true;

            resetPasswordButton.textContent =
                "Resetting...";


            try {

                const response =
                    await fetch(
                        "/api/reset-password",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                identifier:
                                    identifier,

                                otp:
                                    otp,

                                password:
                                    password

                            })
                        }
                    );


                const result =
                    await response.json();


                if (!response.ok) {

                    alert(
                        result.message ||
                        "Password reset failed."
                    );

                    return;

                }


                alert(
                    result.message ||
                    "Password reset successfully."
                );


                showLogin();


            } catch (error) {

                console.error(
                    "Reset password error:",
                    error
                );


                alert(
                    "Could not connect to the VozaChat server."
                );

            } finally {

                resetPasswordButton.disabled =
                    false;

                resetPasswordButton.textContent =
                    "Reset password";

            }

        }
    );

}


/* =========================================================
   RESTORE PENDING REGISTRATION
   ========================================================= */

function restorePendingRegistration() {

    pendingRegistrationUserId =
        localStorage.getItem(
            "vozachatPendingUserId"
        ) || null;


    pendingRegistrationUsername =
        localStorage.getItem(
            "vozachatPendingUsername"
        ) || null;

}



/* =========================================================
   INITIALIZE VOZACHAT
   ========================================================= */

loadSavedTheme();

loadSavedUser();

restorePendingRegistration();


/*
   Protect the app.
   If nobody is logged in,
   show the account / login screen first.
*/

if (!isLoggedIn()) {

    hideAllSections();

    accountSection.style.display =
        "block";

    accountSection.classList.add(
        "active-section"
    );

    showLogin();

} else {

    showSection("chats");
    activateTab("chats");

}


/*
   Load users in the background.
*/

loadUsers();


/*
   If a user is already logged in,
   refresh their chat list.
*/

if (isLoggedIn()) {

    updateChatList();

}


/* =========================================================
   DEBUG MESSAGE
   ========================================================= */

console.log(
    "VozaChat script loaded successfully."
);
