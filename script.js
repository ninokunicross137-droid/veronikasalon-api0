const result = document.getElementById("result");
const message = document.getElementById("message");
const bookingSuccess = document.getElementById("bookingSuccess");
const dateInput = document.getElementById("date");
const form = document.getElementById("bookingForm");
const API_BASE = String(window.VERONIKA_API_URL || "").replace(/\/+$/, "");
const procedureInputs = [...document.querySelectorAll('input[name="procedure"]')];

function selectedProcedures() {
    return procedureInputs.filter(input => input.checked);
}
function calculatePrice() {
    const total = selectedProcedures().reduce((sum, input) => sum + Number(input.dataset.price), 0);
    result.textContent = "Итого: " + total.toLocaleString("ru-RU") + " ₽";
}
procedureInputs.forEach(input => input.addEventListener("change", calculatePrice));

const today = new Date();
const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split("T")[0];
dateInput.min = localDate;

form.addEventListener("submit", async event => {
    event.preventDefault();
    message.textContent = "";
    const selected = selectedProcedures();
    if (!selected.length) {
        message.textContent = "Выберите хотя бы одну процедуру.";
        return;
    }
    if (!API_BASE) {
        message.textContent = "Сайт ещё не подключён к API.";
        return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Отправляем...";
    const payload = {
        name: document.getElementById("name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        services: selected.map(input => input.value),
        date: dateInput.value,
        time: document.getElementById("time").value
    };
    try {
        const response = await fetch(API_BASE + "/api/bookings", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Не удалось сохранить запись.");
        const total = selected.reduce((sum, input) => sum + Number(input.dataset.price), 0);
        document.getElementById("successName").textContent = payload.name;
        document.getElementById("successDate").textContent = new Date(payload.date + "T12:00:00").toLocaleDateString("ru-RU", {day:"numeric", month:"long", year:"numeric"}) + " · " + payload.time;
        document.getElementById("successServices").textContent = selected.map(input => input.dataset.title).join(", ");
        document.getElementById("successTotal").textContent = total.toLocaleString("ru-RU") + " ₽";
        form.hidden = true;
        bookingSuccess.hidden = false;
        bookingSuccess.scrollIntoView({behavior:"smooth", block:"center"});
    } catch (error) {
        message.textContent = error.message === "Failed to fetch"
            ? "Не удалось связаться с сервером. Проверьте подключение."
            : error.message;
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Подтвердить запись <span>↗</span>';
    }
});
calculatePrice();

document.getElementById("bookAgain").addEventListener("click", () => {
    bookingSuccess.hidden = true;
    form.hidden = false;
    form.reset();
    message.textContent = "";
    calculatePrice();
    form.scrollIntoView({behavior:"smooth", block:"start"});
});