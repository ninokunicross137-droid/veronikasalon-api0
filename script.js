const service = document.getElementById("service");
const extra = document.getElementById("extra");
const result = document.getElementById("result");
const message = document.getElementById("message");
const dateInput = document.getElementById("date");
const form = document.getElementById("bookingForm");

// Укажите здесь публичный адрес API из панели ONREZA, без завершающего слэша.
const API_BASE = String(window.VERONIKA_API_URL || "").replace(/\/+$/, "");

function calculatePrice() {
    const total = Number(service.value) + Number(extra.value);
    result.textContent = "Стоимость: " + total + " ₽";
}

service.addEventListener("change", calculatePrice);
extra.addEventListener("change", calculatePrice);

const today = new Date();
const localDate = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000
).toISOString().split("T")[0];
dateInput.min = localDate;

form.addEventListener("submit", async function(event) {
    event.preventDefault();
    message.textContent = "";

    if (!API_BASE) {
        message.textContent = "Сайт ещё не подключён к API. Укажите адрес API ONREZA в VERONIKA_API_URL.";
        return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Отправляем...";

    const payload = {
        name: document.getElementById("name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        service: service.value === "1200" ? "basic" : "color",
        extra: extra.value === "50" ? "repair" :
            extra.value === "100" ? "extension" :
            extra.value === "150" ? "nails" : "none",
        date: dateInput.value,
        time: document.getElementById("time").value
    };

    try {
        const response = await fetch(API_BASE + "/api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || "Не удалось сохранить запись.");
        }

        message.textContent = "Вы успешно записались! Вероника свяжется с вами.";
        form.reset();
        calculatePrice();
    } catch (error) {
        message.textContent = error.message === "Failed to fetch"
            ? "Не удалось связаться с сервером. Проверьте адрес API и настройки CLIENT_ORIGIN."
            : error.message;
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Записаться";
    }
});

calculatePrice();
