export const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;",
})[character]);

export const plural = (count, word) => count + " " + word + (count === 1 ? "" : "s");

export const text = (value) => value == null || value === "" ? "—" : escape(value);

export const signed = (value) => typeof value === "number" && value >= 0 ? "+" + value : text(value);
