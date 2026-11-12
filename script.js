const service = document.getElementById("service");
const extra = document.getElementById("extra");
const result = document.getElementById("result");

function calculatePrice() {
    let total =
        Number(service.value) +
        Number(extra.value);

    result.textContent =
        "Стоимость: " + total + " ₽";
}

service.addEventListener("change", calculatePrice);
extra.addEventListener("change", calculatePrice);

const dateInput = document.getElementById("date");

const today = new Date();
const localDate = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000
).toISOString().split("T")[0];

dateInput.min = localDate;

let bookings = JSON.parse(
    localStorage.getItem("bookings") || "[]"
);

document.getElementById("bookingForm")
.addEventListener("submit", function(event) {

    event.preventDefault();

    const name = document.getElementById("name").value;
    const phone = document.getElementById("phone").value;
    const date = dateInput.value;
    const time = document.getElementById("time").value;

    const exists = bookings.some(
        booking =>
            booking.date === date &&
            booking.time === time
    );

    if (exists) {
        document.getElementById("message").textContent =
            "Это время уже занято. Выберите другое.";

        return;
    }

    const booking = {
        name: name,
        phone: phone,
        service: service.options[service.selectedIndex].text,
        date: date,
        time: time,
        price: Number(service.value) + Number(extra.value)
    };

    bookings.push(booking);

    localStorage.setItem(
        "bookings",
        JSON.stringify(bookings)
    );

    document.getElementById("message").textContent =
        "Вы успешно записались! Вероника свяжется с вами.";

    this.reset();

    calculatePrice();

});
