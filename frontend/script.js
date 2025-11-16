// Utility Functions
const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatTimeShort = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
};

// Add error handler for API calls
const apiCall = async (url, options = {}) => {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `API error: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`API call failed: ${error.message}`);
    showToast(`Error: ${error.message}`);
    throw error;
  }
}

const showToast = (message, duration = 3000) => {
  try {
    const toast = document.getElementById('toast');
    if (!toast) {
      console.error('Toast element not found');
      return;
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  } catch (error) {
    console.error('Error showing toast:', error);
  }
};

const updateAuthUI = () => {
  try {
    const isLoggedIn = storage.get('isLoggedIn', false);
    const guestAuth = document.getElementById('guestAuth');
    const logoutLink = document.getElementById('logoutLink');
    const usernameSpan = document.getElementById('username');

    const savedName = storage.get('username', 'User');
    if (usernameSpan) usernameSpan.textContent = savedName;

    if (isLoggedIn) {
      if (guestAuth) guestAuth.style.display = 'none';
      if (logoutLink) logoutLink.style.display = 'flex';
    } else {
      if (guestAuth) guestAuth.style.display = 'flex';
      if (logoutLink) logoutLink.style.display = 'none';
    }
  } catch (error) {
    console.error('Error updating auth UI:', error);
  }
};

const removeStorage = (key) => {
    localStorage.removeItem(key);
};

// Local Storage
const storage = {
    get: (key, defaultValue = null) => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    },
    set: (key, value) => {
        localStorage.setItem(key, JSON.stringify(value));
    }
};

// --- App State ---
let calendarDate = new Date();
let streakYear = new Date().getFullYear();

// --- Navigation ---
const pages = document.querySelectorAll('.page');
const navItems = document.querySelectorAll('.nav-item');

const navigateTo = (pageId) => {
    pages.forEach(page => page.classList.remove('active'));
    navItems.forEach(item => item.classList.remove('active'));
    
    const targetPage = document.getElementById(pageId);
    let targetNav = document.querySelector(`.nav-item[data-page="${pageId}"]`);

    if(pageId === 'full-report'){
        targetNav = document.querySelector(`.nav-item[data-page="stats"]`);
    }
    
    if (targetPage) targetPage.classList.add('active');
    if (targetNav) targetNav.classList.add('active');
    
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
    }
    updateAuthUI();

    if (pageId === 'dashboard') updateDashboard();
    if (pageId === 'stats') {
        selectedStatsDate = null; 
        document.querySelector('#datePickerBtn span').textContent = 'View specific date';
        currentStatsPeriod = storage.get('currentStatsPeriod', 'today');
        updateStats(); 
    }
    if (pageId === 'timer') updateTimerSummary();
    if (pageId === 'routine') {
        isEditingRoutine = false;
        document.getElementById('editRoutineBtn').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit`;
        document.getElementById('addSlotBtn').style.display = 'none';
        loadRoutine();
        renderRoutine();
    }
    if (pageId === 'todos') renderTasks();
};

document.querySelectorAll('[data-page]').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        if (page) navigateTo(page);
    });
});

// --- Sidebar Toggle ---
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
});

// --- Theme Toggle ---
const themeToggle = document.getElementById('themeToggle');
const currentTheme = storage.get('theme', 'light');

if (currentTheme === 'dark') {
    document.documentElement.classList.add('dark');
} else {
    document.documentElement.classList.remove('dark');
}

themeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    storage.set('theme', theme);
});

// --- Dashboard ---
const updateDashboard = () => {
    const sessions = storage.get('timeSessions', []);
    const todos = storage.get('todos', []);
    const today = new Date().toDateString();
    
    const todayStudy = sessions
        .filter(s => new Date(s.date).toDateString() === today && s.type === 'study')
        .reduce((acc, s) => acc + s.duration, 0);
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStudy = sessions
        .filter(s => new Date(s.date) >= weekAgo && s.type === 'study')
        .reduce((acc, s) => acc + s.duration, 0);
    
    const completedTodos = todos.filter(t => t.completed).length;
    const totalTodos = todos.length;
    
    const statsHtml = `
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Today's Study Time</span>
                <div class="stat-icon primary">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                </div>
            </div>
            <div class="stat-value primary">${formatTimeShort(todayStudy)}</div>
            <p class="stat-description">${todayStudy > 0 ? 'Keep up the great work! 👍' : 'Start your study session!'}</p>
        </div>
        
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">This Week</span>
                <div class="stat-icon success">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="20" x2="12" y2="10"/>
                        <line x1="18" y1="20" x2="18" y2="4"/>
                        <line x1="6" y1="20" x2="6" y2="16"/>
                    </svg>
                </div>
            </div>
            <div class="stat-value success">${formatTimeShort(weekStudy)}</div>
            <p class="stat-description">Total study time this week</p>
        </div>
        
        <div class="stat-card">
            <div class="stat-header">
                <span class="stat-label">Tasks Completed</span>
                <div class="stat-icon success">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                </div>
            </div>
            <div class="stat-value success">${completedTodos}/${totalTodos}</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${totalTodos > 0 ? (completedTodos / totalTodos) * 100 : 0}%"></div>
            </div>
            <p class="stat-description">${completedTodos === totalTodos && totalTodos > 0 ? 'All done! 🎉' : `${totalTodos > 0 ? Math.round((completedTodos / totalTodos) * 100) : 0}% complete`}</p>
        </div>`;
    
    document.getElementById('dashboardStats').innerHTML = statsHtml;
    
    const recentTodos = [...todos].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    const tasksHtml = todos.length === 0 ? 
        '<div class="empty-state-icon"><p>No tasks yet. Create your first todo!</p></div>' :
        '<ul class="task-preview-list">' + recentTodos.slice(0, 5).map(todo => `
            <li class="task-preview-item">
                ${todo.completed ? 
                    `<div class="task-icon completed"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>` :
                    '<div class="task-icon pending"></div>'}
                <span class="${todo.completed ? 'completed' : ''}">${todo.text}</span>
            </li>
        `).join('') + '</ul>';
    
    document.getElementById('dashboardTasks').innerHTML = tasksHtml;

    // Streak Calendar
    setupStreakCalendar();
};

// --- Todo List ---
let todos = storage.get('todos', []);

const renderTasks = () => {
    const activeTodosList = document.getElementById('activeTodos');
    const completedTodosList = document.getElementById('completedTodos');
    const activeEmptyState = document.getElementById('activeTodoEmptyState');
    const completedEmptyState = document.getElementById('completedTodoEmptyState');
    
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    
    todos = todos.filter(t => !t.completed || (t.completedAt && new Date(t.completedAt).getTime() > oneWeekAgo));
    storage.set('todos', todos);
    
    const activeTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);
    
    document.getElementById('activeTodoCount').textContent = activeTodos.length;
    document.getElementById('completedTodoCount').textContent = completedTodos.length;
    
    activeTodosList.innerHTML = activeTodos.map(todo => createTaskElement(todo)).join('');
    completedTodosList.innerHTML = completedTodos.map(todo => createTaskElement(todo)).join('');
    
    activeEmptyState.style.display = activeTodos.length ? 'none' : 'flex';
    completedEmptyState.style.display = completedTodos.length ? 'none' : 'flex';

    addEventListenersForTasks('#activeTodos');
    addEventListenersForTasks('#completedTodos');
};

const createTaskElement = (todo) => {
    return `
        <li class="task-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
            <input type="checkbox" class="task-checkbox" ${todo.completed ? 'checked' : ''} data-id="${todo.id}">
            <span class="task-text">${todo.text}</span>
            <div class="task-actions">
                <button class="task-action-btn task-edit" data-id="${todo.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="task-action-btn task-delete" data-id="${todo.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </li>
    `;
};

const handleEditTask = (taskId) => {
    const taskItem = document.querySelector(`.task-item[data-id="${taskId}"]`);
    if (!taskItem || taskItem.classList.contains('is-editing')) return;

    taskItem.classList.add('is-editing');

    const taskTextSpan = taskItem.querySelector('.task-text');
    const currentText = taskTextSpan.textContent;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.className = 'input task-edit-input';

    const saveEdit = () => {
        const newText = input.value.trim();
        const todo = todos.find(t => t.id === taskId);
        if (todo && newText) {
            todo.text = newText;
            storage.set('todos', todos);
            showToast('Task updated!');
        }
        // Re-render the relevant view to exit editing mode
        if (document.getElementById('todos').classList.contains('active')) renderTasks();
        else if (document.getElementById('stats').classList.contains('active')) updateStats();
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') {
             if (document.getElementById('todos').classList.contains('active')) renderTasks();
             else if (document.getElementById('stats').classList.contains('active')) updateStats();
        }
    });

    taskTextSpan.replaceWith(input);
    input.focus();
};

const handleDeleteTask = (taskId) => {
    todos = todos.filter(t => t.id !== taskId);
    storage.set('todos', todos);
    
    if (document.getElementById('todos').classList.contains('active')) {
        renderTasks();
    }
    if (document.getElementById('stats').classList.contains('active')) {
        updateStats();
    }
    if (document.getElementById('dashboard').classList.contains('active')) {
        updateDashboard();
    }
    showToast('Task deleted');
};


const addEventListenersForTasks = (containerSelector) => {
    const container = document.querySelector(containerSelector);
    if(!container) return;

    container.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.task-edit');
        if (editBtn) {
            handleEditTask(editBtn.dataset.id);
            return;
        }

        const deleteBtn = e.target.closest('.task-delete');
        if (deleteBtn) {
            handleDeleteTask(deleteBtn.dataset.id);
            return;
        }
    });

    container.querySelectorAll('.task-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const todoId = e.target.dataset.id;
            const todoItem = todos.find(t => t.id === todoId);
            if (todoItem) {
                todoItem.completed = e.target.checked;
                todoItem.completedAt = e.target.checked ? new Date().toISOString() : null;
                storage.set('todos', todos);
                renderTasks();
                if(document.getElementById('stats').classList.contains('active')) {
                    updateStats();
                }
                showToast(e.target.checked ? 'Task completed! ✅' : 'Task reopened');
            }
        });
    });
};

document.getElementById('addTodoBtn').addEventListener('click', () => {
    const input = document.getElementById('newTodo');
    const text = input.value.trim();
    
    if (text) {
        todos.unshift({
            id: Date.now().toString(),
            text,
            completed: false,
            createdAt: new Date().toISOString()
        });
        storage.set('todos', todos);
        input.value = '';
        renderTasks();
        showToast('Task added! ✨');
    }
});

document.getElementById('newTodo').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('addTodoBtn').click();
    }
});

// --- Timer ---
let timerState = storage.get('timerState', {
    seconds: 0,
    isRunning: false,
    isBreak: false,
    currentTask: '',
    startTime: null
});

let timerInterval = null;

const updateTimerDisplay = () => {
    const seconds = timerState.isRunning
        ? Math.floor((Date.now() - timerState.startTime) / 1000)
        : timerState.seconds;
    document.getElementById('timerDisplay').textContent = formatTime(seconds);
};

const updateTimerSummary = () => {
    const sessions = storage.get('timeSessions', []);
    const today = new Date().toDateString();
    
    const todaySessions = sessions.filter(s => new Date(s.date).toDateString() === today);
    const studyTime = todaySessions.filter(s => s.type === 'study').reduce((acc, s) => acc + s.duration, 0);
    const breakTime = todaySessions.filter(s => s.type === 'break').reduce((acc, s) => acc + s.duration, 0);
    const sessionCount = todaySessions.length;
    
    document.getElementById('todaySummary').innerHTML = `
        <div class="summary-item">
            <span class="summary-label">Study Time</span>
            <span class="summary-value-timer primary">${formatTime(studyTime)}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Goal: 8h</span>
            <div class="progress-bar" style="width: 120px; flex-shrink: 0;"><div class="progress-fill" style="background: hsl(var(--primary)); width: ${Math.min((studyTime / (8 * 3600)) * 100, 100)}%"></div></div>
        </div>
        <div class="summary-item">
            <span class="summary-label">Break Time</span>
            <span class="summary-value-timer success">${formatTime(breakTime)}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Recommended: 2h</span>
            <div class="progress-bar" style="width: 120px; flex-shrink: 0;"><div class="progress-fill" style="width: ${Math.min((breakTime / (2 * 3600)) * 100, 100)}%"></div></div>
        </div>
        <div class="summary-item">
            <span class="summary-label">Sessions Today</span>
            <span class="summary-value">${sessionCount}</span>
        </div>`;
};

const startTimer = () => {
    if (timerInterval) return;
    
    timerState.isRunning = true;
    timerState.startTime = Date.now() - (timerState.seconds * 1000);
    
    timerInterval = setInterval(updateTimerDisplay, 1000);
    
    document.getElementById('toggleTimerBtn').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>Pause`;
    document.getElementById('endSessionBtn').style.display = 'inline-flex';
    document.getElementById('currentTask').disabled = true;
};

const pauseTimer = () => {
    if (!timerInterval) return;
    
    clearInterval(timerInterval);
    timerInterval = null;
    timerState.isRunning = false;
    timerState.seconds = Math.floor((Date.now() - timerState.startTime) / 1000);
    storage.set('timerState', timerState);
    
    document.getElementById('toggleTimerBtn').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Start`;
};

const endSession = (showMsg = true) => {
    const sessionDuration = timerState.isRunning ? Math.floor((Date.now() - timerState.startTime) / 1000) : timerState.seconds;

    if (sessionDuration > 0) {
        const sessions = storage.get('timeSessions', []);
        sessions.push({
            date: new Date().toISOString(),
            duration: sessionDuration,
            type: timerState.isBreak ? 'break' : 'study',
            task: !timerState.isBreak ? timerState.currentTask : undefined
        });
        storage.set('timeSessions', sessions);
        
        if (showMsg) showToast(`${timerState.isBreak ? 'Break completed!' : 'Study session saved!'} Duration: ${formatTimeShort(sessionDuration)}`);
    }
    
    pauseTimer();
    timerState.seconds = 0;
    timerState.currentTask = document.getElementById('currentTask').value;
    storage.set('timerState', timerState);
    
    document.getElementById('currentTask').disabled = false;
    document.getElementById('endSessionBtn').style.display = 'none';
    updateTimerDisplay();
    updateTimerSummary();
    
    // Update dashboard streak if visible
    if(document.getElementById('dashboard').classList.contains('active')) {
        updateDashboard();
    }
};

const resetTimer = () => {
    pauseTimer();
    timerState.seconds = 0;
    timerState.currentTask = '';
    storage.set('timerState', timerState);
    
    document.getElementById('currentTask').value = '';
    document.getElementById('currentTask').disabled = false;
    document.getElementById('endSessionBtn').style.display = 'none';
    updateTimerDisplay();
};

const toggleBreakMode = () => {
    if (timerState.isRunning || timerState.seconds > 0) {
        endSession(false);
    }
    resetTimer();

    timerState.isBreak = !timerState.isBreak;
    storage.set('timerState', timerState);
    updateTimerVisuals();
    showToast(`${timerState.isBreak ? 'Break mode activated' : 'Study mode activated'}`);
};

const updateTimerVisuals = () => {
    const card = document.getElementById('timerCard');
    const title = document.getElementById('timerTitle');
    const toggleBtn = document.getElementById('toggleBreakBtn');
    const taskInput = document.getElementById('taskInputGroup');
    
    card.classList.toggle('break-mode', timerState.isBreak);
    taskInput.style.display = timerState.isBreak ? 'none' : 'flex';
    toggleBtn.textContent = timerState.isBreak ? 'Switch to Study Mode' : 'Switch to Break Mode';
    title.innerHTML = timerState.isBreak
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px; display: inline-block; vertical-align: middle; margin-right: 8px;"><path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>Break Timer`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px; display: inline-block; vertical-align: middle; margin-right: 8px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>Study Timer`;

    updateTimerDisplay();
};

// Initialize timer
document.getElementById('currentTask').value = timerState.currentTask || '';
if (timerState.isRunning) {
    startTimer();
}
updateTimerVisuals();

// Timer Event Listeners
document.getElementById('toggleTimerBtn').addEventListener('click', () => {
    const task = document.getElementById('currentTask').value.trim();
    if (!timerState.isBreak && !task && !timerState.isRunning && timerState.seconds === 0) {
        showToast('Please enter what you are studying');
        return;
    }
    
    if (!timerState.isRunning) {
        timerState.currentTask = task;
        storage.set('timerState', timerState);
        startTimer();
    } else {
        pauseTimer();
    }
});
document.getElementById('endSessionBtn').addEventListener('click', () => endSession(true));
document.getElementById('resetTimerBtn').addEventListener('click', resetTimer);
document.getElementById('toggleBreakBtn').addEventListener('click', toggleBreakMode);

// --- Daily Routine ---
const defaultRoutine = [
    { id: '1', time: '06:00 AM', activity: 'Wake up & Morning routine' },
    { id: '2', time: '07:00 AM', activity: 'Breakfast' },
    { id: '3', time: '08:00 AM', activity: 'Study Session 1' },
    { id: '4', time: '10:00 AM', activity: 'Break' },
    { id: '5', time: '10:30 AM', activity: 'Study Session 2' },
    { id: '6', time: '12:30 PM', activity: 'Lunch' },
    { id: '7', time: '02:00 PM', activity: 'Study Session 3' },
    { id: '8', time: '04:00 PM', activity: 'Exercise' },
    { id: '9', time: '05:00 PM', activity: 'Study Session 4' },
    { id: '10', time: '07:00 PM', activity: 'Dinner' },
    { id: '11', time: '08:00 PM', activity: 'Free time / Hobbies' },
    { id: '12', time: '10:00 PM', activity: 'Sleep preparation' }
];

let routine = [];
let isEditingRoutine = false;

const loadRoutine = () => {
    let savedRoutine = storage.get('routine');
    if (Array.isArray(savedRoutine) && savedRoutine.length > 0 && savedRoutine[0].hasOwnProperty('time') && savedRoutine[0].hasOwnProperty('activity')) {
        routine = savedRoutine;
    } else {
        routine = JSON.parse(JSON.stringify(defaultRoutine)); 
    }
};

const renderRoutine = () => {
    const schedule = document.getElementById('routineSchedule');
    schedule.innerHTML = '';
    
    const parseTime = (timeStr) => {
        if (typeof timeStr !== 'string') return 9999;
        const match = timeStr.match(/(\d{1,2}):?(\d{2})\s*(AM|PM)?/i);
        if (!match) return 9999;
        let [_, h, m, p] = match;
        let hours = parseInt(h);
        if (p) {
            p = p.toUpperCase();
            if (p === 'PM' && hours !== 12) hours += 12;
            if (p === 'AM' && hours === 12) hours = 0;
        }
        return hours * 60 + parseInt(m);
    };
    
    routine.sort((a, b) => parseTime(a.time) - parseTime(b.time));

    routine.forEach(item => {
        const div = document.createElement('div');
        div.className = `routine-item ${isEditingRoutine ? 'editing' : ''}`;
        div.dataset.id = item.id;
        
        if (isEditingRoutine) {
            div.innerHTML = `
                <div class="routine-edit-group">
                    <input type="text" class="input routine-time-input" value="${item.time || ''}" placeholder="e.g. 08:00 AM">
                    <input type="text" class="input routine-activity-input" value="${item.activity || ''}" placeholder="Activity">
                    <button class="delete-routine-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>`;
        } else {
            div.innerHTML = `
                <div class="routine-time">${item.time || 'N/A'}</div>
                <div class="routine-activity">${item.activity || 'No Activity'}</div>`;
        }
        schedule.appendChild(div);
    });
};

const addRoutineEventListeners = () => {
    const schedule = document.getElementById('routineSchedule');
    
    schedule.addEventListener('input', (e) => {
        if (!isEditingRoutine) return;
        const target = e.target;
        const parentItem = target.closest('.routine-item');
        if (!parentItem) return;

        const itemId = parentItem.dataset.id;
        const itemToUpdate = routine.find(r => r.id === itemId);

        if (itemToUpdate) {
            if (target.classList.contains('routine-time-input')) {
                itemToUpdate.time = target.value;
            } else if (target.classList.contains('routine-activity-input')) {
                itemToUpdate.activity = target.value;
            }
        }
    });

    schedule.addEventListener('click', (e) => {
        if (!isEditingRoutine) return;
        const deleteBtn = e.target.closest('.delete-routine-btn');
        if (deleteBtn) {
            const parentItem = deleteBtn.closest('.routine-item');
            const idToDelete = parentItem.dataset.id;
            routine = routine.filter(r => r.id !== idToDelete);
            renderRoutine();
        }
    });
};

document.getElementById('editRoutineBtn').addEventListener('click', () => {
    isEditingRoutine = !isEditingRoutine;
    const btn = document.getElementById('editRoutineBtn');
    const addSlotBtn = document.getElementById('addSlotBtn');
    
    btn.innerHTML = isEditingRoutine
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit`;
    
    addSlotBtn.style.display = isEditingRoutine ? 'inline-flex' : 'none';

    if (!isEditingRoutine) {
        storage.set('routine', routine);
        showToast('Routine saved!');
    } else {
        loadRoutine();
    }
    renderRoutine();
});

document.getElementById('addSlotBtn').addEventListener('click', () => {
    if (!isEditingRoutine) return;
    routine.push({ id: Date.now().toString(), time: '00:00', activity: 'Work' });
    renderRoutine();
});

addRoutineEventListeners();


// --- Statistics ---
let currentStatsPeriod = storage.get('currentStatsPeriod', 'today');
let selectedStatsDate = null; 

const calculateStats = (period, dateOverride = null) => {
    const sessions = storage.get('timeSessions', []);
    let now = dateOverride ? new Date(dateOverride) : new Date();
    if(dateOverride) now.setHours(23, 59, 59);

    let cutoff;
    
    switch (period) {
        case 'today':
            cutoff = new Date(now);
            cutoff.setHours(0, 0, 0, 0);
            break;
        case 'week':
            cutoff = new Date(now);
            cutoff.setDate(now.getDate() - now.getDay()); 
            cutoff.setHours(0, 0, 0, 0);
            break;
        case 'month':
            cutoff = new Date(now);
            cutoff.setDate(1); 
            cutoff.setHours(0, 0, 0, 0);
            break;
        case 'year':
            cutoff = new Date(now);
            cutoff.setMonth(0, 1);
            cutoff.setHours(0, 0, 0, 0);
            break;
    }

    const periodSessions = sessions.filter(s => {
        const sessionDate = new Date(s.date);
        return sessionDate >= cutoff && sessionDate <= now && s.type === 'study';
    });
    
    const total = periodSessions.reduce((acc, s) => acc + s.duration, 0);
    const count = periodSessions.length;
    const average = count > 0 ? total / count : 0; 
    
    return { total, sessions: count, average };
};

const renderCustomDateStats = (dateString) => {
    const date = new Date(dateString);
    const localDate = new Date(date.getTime() + date.getTimezoneOffset() * 60000);
    const dateStr = localDate.toDateString();
    
    document.getElementById('customDateTitle').textContent = `Stats for ${localDate.toLocaleDateString('default', { year: 'numeric', month: 'long', day: 'numeric' })}`;

    const sessions = storage.get('timeSessions', []);
    const todos = storage.get('todos', []);

    // Calculate stats for the selected day
    const daySessions = sessions.filter(s => new Date(s.date).toDateString() === dateStr && s.type === 'study');
    const totalStudyTime = daySessions.reduce((acc, s) => acc + s.duration, 0);
    const sessionCount = daySessions.length;

    document.getElementById('customDateStatsGrid').innerHTML = `
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Total Study Time</span><div class="stat-icon primary"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div></div>
            <div class="stat-value primary">${formatTimeShort(totalStudyTime)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-header"><span class="stat-label">Sessions Completed</span><div class="stat-icon success"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div></div>
            <div class="stat-value success">${sessionCount}</div>
        </div>
    `;

    // NEW: Calculate and display study tasks for the selected day
    const studyTaskMap = daySessions.reduce((acc, s) => {
        if (s.task) {
            acc[s.task] = (acc[s.task] || 0) + s.duration;
        }
        return acc;
    }, {});
    const studyTasks = Object.entries(studyTaskMap).map(([task, duration]) => ({ task, duration }))
        .sort((a, b) => b.duration - a.duration);

    const studyList = document.getElementById('customDateStudySubjects');
    const studyEmptyState = document.getElementById('customDateStudyEmptyState');

    if (studyTasks.length > 0) {
        // Re-using subject-item structure, but without edit/delete buttons for simplicity
        studyList.innerHTML = studyTasks.map(t => `
            <div class="subject-item custom-date-subject">
                <div class="subject-item-header">
                    <span class="subject-item-name">${t.task || 'Untagged Session'}</span>
                    <span class="subject-item-time">${formatTimeShort(t.duration)}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 100%; background: hsl(var(--primary));"></div>
                </div>
            </div>`).join('');
        studyList.style.display = 'flex';
        studyEmptyState.style.display = 'none';
    } else {
        studyList.innerHTML = '';
        studyList.style.display = 'none';
        studyEmptyState.style.display = 'flex';
    }


    // Filter and display tasks completed on that day
    const completedTasksOnDay = todos.filter(t => {
        return t.completed && t.completedAt && new Date(t.completedAt).toDateString() === dateStr;
    });

    const tasksList = document.getElementById('customDateTasks');
    const taskEmptyState = document.getElementById('customDateTaskEmptyState');

    if (completedTasksOnDay.length > 0) {
        tasksList.innerHTML = completedTasksOnDay.map(t => createTaskElement(t)).join('');
        addEventListenersForTasks('#customDateTasks');
        tasksList.style.display = 'flex';
        taskEmptyState.style.display = 'none';
    } else {
        tasksList.innerHTML = '';
        tasksList.style.display = 'none';
        taskEmptyState.style.display = 'flex';
    }
};

const updateStats = () => {
    const defaultView = document.getElementById('stats-default-view');
    const customDateView = document.getElementById('stats-custom-date-view');
    const clearDateBtn = document.getElementById('clearDateBtn');

    if (selectedStatsDate) {
        // Show custom date view
        defaultView.style.display = 'none';
        customDateView.style.display = 'block';
        clearDateBtn.style.display = 'inline-flex';
        renderCustomDateStats(selectedStatsDate);
    } else {
        // Show default tabbed view
        defaultView.style.display = 'block';
        customDateView.style.display = 'none';
        clearDateBtn.style.display = 'none';

        const stats = calculateStats(currentStatsPeriod);
    
        document.getElementById('statsMainGrid').innerHTML = `
            <div class="stat-card clickable" id="totalStudyTimeCard" data-period="${currentStatsPeriod}">
                <div class="stat-header"><span class="stat-label">Total Study Time</span><div class="stat-icon primary"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div></div>
                <div class="stat-value primary">${formatTimeShort(stats.total)}</div>
                <p class="stat-description">Total time in this period</p>
                <p class="stat-hint">Click to view detailed breakdown</p>
            </div>
            <div class="stat-card">
                <div class="stat-header"><span class="stat-label">Sessions Completed</span><div class="stat-icon success"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div></div>
                <div class="stat-value success">${stats.sessions}</div>
                <p class="stat-description">Study sessions in this period</p>
            </div>
            <div class="stat-card">
                <div class="stat-header"><span class="stat-label">Average Session</span><div class="stat-icon accent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></div></div>
                <div class="stat-value accent">${formatTimeShort(stats.average)}</div>
                <p class="stat-description">Per session in this period</p>
            </div>`;
        
        document.getElementById('totalStudyTimeCard').addEventListener('click', (e) => {
            const period = e.currentTarget.dataset.period;
            openChartModal(period, selectedStatsDate);
        });

        renderTimeBySubject();
        renderRecentCompletedTasks();
        renderProgressInsights();
    }
    updateStatsTabs();
};

const updateStatsTabs = () => {
    const tabs = document.querySelectorAll('#statsTabList .tab');
    const tabContainer = document.getElementById('statsTabList');
    
    if (selectedStatsDate) {
        tabContainer.style.opacity = '0.5';
        tabs.forEach(tab => {
            tab.classList.remove('active');
            tab.disabled = true;
        });
    } else {
        tabContainer.style.opacity = '1';
        tabs.forEach(tab => {
            tab.disabled = false;
            tab.classList.toggle('active', tab.dataset.tab === currentStatsPeriod)
        });
    }
};

const handleEditSubject = (subjectItemElement) => {
    if (subjectItemElement.classList.contains('is-editing')) return;
    subjectItemElement.classList.add('is-editing');

    const nameSpan = subjectItemElement.querySelector('.subject-item-name');
    const oldName = nameSpan.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'input subject-edit-input';

    const saveEdit = () => {
        const newName = input.value.trim();
        if (newName && newName !== oldName) {
            let sessions = storage.get('timeSessions', []);
            sessions.forEach(session => {
                if (session.task === oldName) {
                    session.task = newName;
                }
            });
            storage.set('timeSessions', sessions);
            showToast(`Subject renamed to "${newName}"`);
        }
        updateStats(); // Re-render the whole stats page
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') updateStats();
    });

    // We no longer hide the time/actions temporarily, as the new CSS layout 
    // accounts for their presence, and we rely on the full re-render on blur/enter/escape.
    nameSpan.replaceWith(input);
    input.focus();
};


const handleDeleteSubject = (subjectName) => {
    if (confirm(`Are you sure you want to delete all study history for the subject "${subjectName}"? This action cannot be undone.`)) {
        let sessions = storage.get('timeSessions', []);
        const updatedSessions = sessions.filter(session => session.task !== subjectName);
        storage.set('timeSessions', updatedSessions);
        showToast(`All history for "${subjectName}" has been deleted.`);
        updateStats();
    }
};

const renderTimeBySubject = () => {
    const sessions = storage.get('timeSessions', []);
    const taskMap = sessions.filter(s => s.task && s.type === 'study').reduce((acc, s) => {
        acc[s.task] = (acc[s.task] || 0) + s.duration;
        return acc;
    }, {});
    
    const tasks = Object.entries(taskMap).map(([task, duration]) => ({ task, duration }))
        .sort((a, b) => b.duration - a.duration);
    
    const totalStudyTime = tasks.reduce((acc, t) => acc + t.duration, 0);
    
    const container = document.getElementById('timeBySubject');
    if (tasks.length === 0) {
        container.innerHTML = `<div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 64px; height: 64px; opacity: 0.1;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg><p>Start tracking with task names to see your subject breakdown!</p></div>`;
        return;
    }
    
    // UPDATED: The structure already allows for cleaner visual using the new CSS
    container.innerHTML = '<div class="subject-list">' + tasks.map(t => `
        <div class="subject-item" data-subject-name="${t.task}">
            <div class="subject-item-header">
                <span class="subject-item-name">${t.task}</span>
                <span class="subject-item-time">${formatTimeShort(t.duration)}</span>
                <div class="subject-item-actions">
                    <button class="subject-action-btn edit">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="subject-action-btn delete">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${totalStudyTime > 0 ? (t.duration / totalStudyTime) * 100 : 0}%"></div>
            </div>
        </div>`).join('') + '</div>';

    container.addEventListener('click', (e) => {
        const subjectItem = e.target.closest('.subject-item');
        if (!subjectItem) return;

        const subjectName = subjectItem.dataset.subjectName;

        if (e.target.closest('.edit')) {
            handleEditSubject(subjectItem);
        }
        if (e.target.closest('.delete')) {
            handleDeleteSubject(subjectName);
        }
    });
};

const renderRecentCompletedTasks = () => {
    const recentCompleted = todos.filter(t => t.completed)
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, 5);
    const container = document.getElementById('recentCompletedTasks');
    if (recentCompleted.length === 0) {
        container.innerHTML = `<div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 64px; height: 64px; opacity: 0.1;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><p>Complete tasks to see them here!</p></div>`;
    } else {
        container.innerHTML = '<ul class="task-list">' + recentCompleted.map(t => createTaskElement(t)).join('') + '</ul>';
        addEventListenersForTasks('#recentCompletedTasks');
    }
};

const renderProgressInsights = () => {
    const sessions = storage.get('timeSessions', []);
    const last7DaysData = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        const dayStudy = sessions.filter(s => new Date(s.date).toDateString() === date.toDateString() && s.type === 'study').reduce((acc, s) => acc + s.duration, 0);
        return { day: date.toLocaleDateString('en-US', { weekday: 'short' }), duration: dayStudy };
    });
    
    const totalTime = last7DaysData.reduce((acc, d) => acc + d.duration, 0);
    const container = document.getElementById('progressInsights');
    container.innerHTML = (totalTime === 0)
        ? `<p class="small-text">Start tracking your study time to see your progress here!</p>`
        : `<p>You studied a total of <strong>${formatTimeShort(totalTime)}</strong> over the last 7 days.</p>
           <p class="small-text">Day breakdown (minutes):</p>
           <div style="display: flex; gap: 10px; margin-top: 1rem; flex-wrap: wrap;">
           ${last7DaysData.map(d => `<span style="background: rgba(255,255,255,0.1); padding: 5px 10px; border-radius: 5px; font-size: 0.8rem;">${d.day}: ${Math.round(d.duration / 60)}m</span>`).join('')}
           </div>`;
};

document.getElementById('statsTabList').addEventListener('click', (e) => {
    if (e.target.classList.contains('tab')) {
        selectedStatsDate = null;
        const btnText = document.querySelector('#datePickerBtn span');
        if (btnText) btnText.textContent = 'View specific date';
        
        currentStatsPeriod = e.target.dataset.tab;
        storage.set('currentStatsPeriod', currentStatsPeriod);
        updateStats();
    }
});

document.getElementById('clearDateBtn').addEventListener('click', () => {
    selectedStatsDate = null;
    document.querySelector('#datePickerBtn span').textContent = 'View specific date';
    updateStats();
});

// --- Custom Calendar ---
const calendarPopup = document.getElementById('calendarPopup');
const datePickerBtn = document.getElementById('datePickerBtn');

const renderCalendar = () => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const today = new Date();
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = `
        <div class="calendar-header">
            <button class="calendar-nav" id="cal-prev">‹</button>
            <span>${calendarDate.toLocaleString('default', { month: 'long' })} ${year}</span>
            <button class="calendar-nav" id="cal-next">›</button>
        </div>
        <div class="calendar-grid">
            ${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => `<div class="calendar-weekday">${d}</div>`).join('')}
            ${Array.from({ length: firstDay }).map(() => '<div></div>').join('')}
            ${Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const currentDate = new Date(year, month, day);
                const isToday = today.toDateString() === currentDate.toDateString();
                const isSelected = selectedStatsDate && new Date(selectedStatsDate).toDateString() === currentDate.toDateString();
                return `<div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${new Date(year, month, day + 1).toISOString().slice(0, 10)}">${day}</div>`;
            }).join('')}
        </div>`;
    calendarPopup.innerHTML = html;
    
    document.getElementById('cal-prev').addEventListener('click', () => { calendarDate.setMonth(month - 1); renderCalendar(); });
    document.getElementById('cal-next').addEventListener('click', () => { calendarDate.setMonth(month + 1); renderCalendar(); });
    
    calendarPopup.querySelectorAll('.calendar-day').forEach(day => {
        day.addEventListener('click', (e) => {
            selectedStatsDate = e.target.dataset.date;
            const date = new Date(selectedStatsDate);
            const localDate = new Date(date.getTime() + date.getTimezoneOffset() * 60000);
            
            document.querySelector('#datePickerBtn span').textContent = `${localDate.toLocaleDateString('default', { month: 'long', day: 'numeric', year: 'numeric' })}`;
            
            updateStats();
            calendarPopup.classList.remove('show');
        });
    });
};

datePickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    calendarPopup.classList.toggle('show');
    if (calendarPopup.classList.contains('show')) {
        renderCalendar();
    }
});

window.addEventListener('click', (e) => {
    if (!calendarPopup.contains(e.target) && !datePickerBtn.contains(e.target)) {
        calendarPopup.classList.remove('show');
    }
});

// --- Chart Modal ---
const graphModal = document.getElementById('graphModal');
document.getElementById('closeModal').addEventListener('click', () => graphModal.classList.remove('active'));
graphModal.addEventListener('click', (e) => { if (e.target === graphModal) graphModal.classList.remove('active'); });

const openChartModal = (period, dateOverride = null) => {
    const sessions = storage.get('timeSessions', []);
    let chartData = [], title = "Study Time", maxVal = 0;
    const now = dateOverride ? new Date(dateOverride) : new Date();

    switch(period) {
        case 'today':
            title = `Today's Hourly Study Time`;
            const dateStr = now.toDateString();
            chartData = Array.from({length: 24}, (_, i) => {
                const hourSessions = sessions.filter(s => {
                    const d = new Date(s.date);
                    return d.toDateString() === dateStr && s.type === 'study' && d.getHours() === i;
                });
                return {
                    label: i === 0 ? '12AM' : i < 12 ? `${i}AM` : i === 12 ? '12PM' : `${i-12}PM`,
                    value: hourSessions.reduce((acc, s) => acc + s.duration, 0)
                };
            });
            break;
        case 'week':
            title = 'Study Time - This Week';
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay());
            weekStart.setHours(0,0,0,0);
            chartData = Array.from({length: 7}, (_, i) => {
                const day = new Date(weekStart);
                day.setDate(weekStart.getDate() + i);
                const dayStr = day.toDateString();
                const daySessions = sessions.filter(s => new Date(s.date).toDateString() === dayStr && s.type === 'study');
                return {
                    label: day.toLocaleDateString('default', { month: 'short', day: 'numeric' }),
                    value: daySessions.reduce((acc, s) => acc + s.duration, 0)
                };
            });
            break;
        case 'month':
            title = `Study Time - ${now.toLocaleString('default', { month: 'long' })}`;
            const year = now.getFullYear();
            const month = now.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            chartData = Array.from({length: daysInMonth}, (_, i) => {
                const day = i + 1;
                const daySessions = sessions.filter(s => {
                    const d = new Date(s.date);
                    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day && s.type === 'study';
                });
                return {
                    label: day,
                    value: daySessions.reduce((acc, s) => acc + s.duration, 0)
                };
            });
            break;
        case 'year':
            title = `Study Time - ${now.getFullYear()}`;
            const currentYear = now.getFullYear();
            chartData = Array.from({length: 12}, (_, i) => {
                const monthSessions = sessions.filter(s => {
                    const d = new Date(s.date);
                    return d.getFullYear() === currentYear && d.getMonth() === i && s.type === 'study';
                });
                return {
                    label: new Date(0, i).toLocaleString('default', { month: 'short' }),
                    value: monthSessions.reduce((acc, s) => acc + s.duration, 0),
                    month: i,
                    year: currentYear
                };
            });
            break;
    }
    
    maxVal = Math.max(...chartData.map(d => d.value), 1);
    const scaleMax = Math.ceil(maxVal / 3600) + 0.5; // in hours
    
    const yAxisHtml = `
        <div class="y-axis">
            <span>${scaleMax.toFixed(1)}h</span>
            <span>${(scaleMax * 0.75).toFixed(1)}h</span>
            <span>${(scaleMax * 0.5).toFixed(1)}h</span>
            <span>${(scaleMax * 0.25).toFixed(1)}h</span>
            <span>0h</span>
        </div>`;
    
    const chartHtml = `
        <div class="chart-container">
            ${yAxisHtml}
            <div class="chart-scroll-container">
                <div class="chart-grid">
                    ${chartData.map((d) => `
                        <div class="chart-bar-group" 
                             ${period === 'year' ? `data-month="${d.month}" data-year="${d.year}"` : ''}>
                            <div class="chart-bar" style="height: ${ (d.value / (scaleMax * 3600)) * 100}%">
                                <div class="chart-tooltip">${formatTimeShort(d.value)}</div>
                            </div>
                            <div class="chart-label">${d.label}</div>
                        </div>`).join('')}
                </div>
            </div>
        </div>
        ${period === 'year' ? '<p class="small-text" style="text-align: center; margin-top: 1rem;">Click on a month to view its daily breakdown.</p>' : ''}`;
        
    document.querySelector('#modalTitle span').textContent = title;
    document.getElementById('modalBody').innerHTML = chartHtml;

    if (period === 'year') {
        document.querySelectorAll('.chart-bar-group').forEach(bar => {
            bar.addEventListener('click', (e) => {
                const month = e.currentTarget.dataset.month;
                const year = e.currentTarget.dataset.year;
                if (month && year) {
                    const newDate = new Date(year, month);
                    openChartModal('month', newDate);
                }
            });
        });
    }

    graphModal.classList.add('active');
};

// --- Streak Calendar ---
const getStreakColorLevel = (seconds) => {
    const hours = seconds / 3600;
    if (hours === 0) return 0;
    if (hours < 1) return 1;
    if (hours < 2) return 2;
    if (hours < 3) return 3;
    return 4;
};

const calculateStreaks = (activityMap) => {
    let longestStreak = 0;
    let currentStreak = 0;
    let tempLongest = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Calculate Current Streak by checking today and yesterday
    const sortedDates = Object.keys(activityMap).sort();
    
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    // Check if today is active
    if (activityMap[todayStr]) {
        currentStreak = 1;
        let day = yesterday;
        let active = true;
        // Go backwards until the streak is broken
        while(active) {
            const dayStr = day.toISOString().slice(0, 10);
            if (activityMap[dayStr]) {
                currentStreak++;
                day.setDate(day.getDate() - 1);
            } else {
                active = false;
            }
        }
    } else if (activityMap[yesterdayStr]) {
        // If today is inactive, check if yesterday was active (i.e. streak broken today, so current streak is 0)
        currentStreak = 0;
    }
    
    // 2. Calculate Longest Streak by iterating through all sorted activity dates
    if (sortedDates.length > 0) {
        tempLongest = 1;
        longestStreak = 1;
        for (let i = 1; i < sortedDates.length; i++) {
            const currentDate = new Date(sortedDates[i]);
            const prevDate = new Date(sortedDates[i - 1]);
            
            // Calculate difference in days, rounding to handle time component differences
            const diffTime = Math.abs(currentDate.getTime() - prevDate.getTime());
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
                tempLongest++;
            } else if (diffDays > 1) {
                if (tempLongest > longestStreak) {
                    longestStreak = tempLongest;
                }
                tempLongest = 1; // Reset for a new potential streak
            }
        }
        if (tempLongest > longestStreak) {
            longestStreak = tempLongest;
        }
    } else {
        longestStreak = 0;
    }

    return { currentStreak, longestStreak };
};

const renderStreakGrid = (year) => {
    const allSessions = storage.get('timeSessions', []);
    const activityMap = allSessions
        .filter(s => s.type === 'study')
        .reduce((acc, session) => {
            // Use only the date part for grouping
            const date = new Date(session.date).toISOString().slice(0, 10);
            acc[date] = (acc[date] || 0) + session.duration;
            return acc;
        }, {});

    const yearActivityMap = Object.keys(activityMap)
        .filter(date => new Date(date).getFullYear() === year)
        .reduce((acc, date) => {
            acc[date] = activityMap[date];
            return acc;
        }, {});

    const streaks = calculateStreaks(activityMap);
    const totalActiveDays = Object.keys(yearActivityMap).length;
    
    const totalYearSessions = allSessions.filter(s => s.type === 'study' && new Date(s.date).getFullYear() === year).length;

    document.getElementById('totalSubmissions').textContent = `${totalYearSessions} sessions in ${year}`;
    document.getElementById('totalActiveDays').textContent = totalActiveDays;
    document.getElementById('maxStreak').textContent = streaks.longestStreak;
    // NEW: Update Current Streak Display
    document.getElementById('currentStreak').textContent = streaks.currentStreak;


    const calendarContainer = document.getElementById('streakCalendar');
    calendarContainer.innerHTML = '';
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    for (let month = 0; month < 12; month++) {
        const monthWrapper = document.createElement('div');
        monthWrapper.className = 'streak-month-wrapper';

        const monthLabel = document.createElement('div');
        monthLabel.className = 'streak-month-label';
        monthLabel.textContent = monthNames[month];
        
        const monthGrid = document.createElement('div');
        monthGrid.className = 'streak-month-grid';

        const firstDateOfMonth = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const firstDayOfWeek = firstDateOfMonth.getDay(); 
        for (let i = 0; i < firstDayOfWeek; i++) {
            const padder = document.createElement('div');
            monthGrid.appendChild(padder);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateString = date.toISOString().slice(0, 10);
            
            const dayDiv = document.createElement('div');
            dayDiv.className = 'streak-day';

            const studySeconds = activityMap[dateString] || 0;
            const colorLevel = getStreakColorLevel(studySeconds);
            dayDiv.classList.add(`streak-level-${colorLevel}`);
            
            const studyTimeText = studySeconds > 0 ? `${formatTimeShort(studySeconds)} of study` : 'no study';
            const tooltipText = `${date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} - ${studyTimeText}`;
            dayDiv.dataset.tooltip = tooltipText;
            
            monthGrid.appendChild(dayDiv);
        }
        
        monthWrapper.appendChild(monthLabel);
        monthWrapper.appendChild(monthGrid);
        calendarContainer.appendChild(monthWrapper);
    }
};


const setupStreakCalendar = () => {
    const yearSelector = document.getElementById('streakYearSelector');
    if (!yearSelector) return; 

    const sessions = storage.get('timeSessions', []);
    let years = [...new Set(sessions.map(s => new Date(s.date).getFullYear()))];
    const currentYear = new Date().getFullYear();
    if (!years.includes(currentYear)) {
        years.push(currentYear);
    }
    if(years.length === 0) {
        years.push(currentYear);
    }
    years.sort((a,b) => b-a);

    yearSelector.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    
    streakYear = years[0];
    yearSelector.value = streakYear;

    renderStreakGrid(streakYear);

    yearSelector.addEventListener('change', (e) => {
        streakYear = parseInt(e.target.value, 10);
        renderStreakGrid(streakYear);
    });
};


// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
    updateAuthUI();                     // <-- initialise UI
    // If we just came back from loginpage.html, localStorage may have changed
    if (performance.navigation.type === 1) {   // reload
        updateAuthUI();
    }

    const logoutLink = document.getElementById('logoutLink');
    logoutLink.addEventListener('click', (e) => {
        e.preventDefault();
        storage.set('isLoggedIn', false);
        removeStorage('username');  // Better to remove than set null, avoids "null" string issues
        updateAuthUI();                 // <-- refresh UI after logout
        showToast('Logged out successfully!');
    });
    // -------------------------------------------------------------------

    navigateTo('dashboard');
});
