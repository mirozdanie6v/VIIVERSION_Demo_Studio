export const RUSSIAN_STRESS_PRONUNCIATION: Readonly<Record<string, string>> = Object.freeze({
  "AVE Dental": "Эй-ви-и Де́нтал",
  "Dental": "Де́нтал",
  "Дентал": "Де́нтал",
  "Виверсион": "Виве́рсион",
  "записаться": "записа́ться",
  "Записаться": "Записа́ться",
  "запись": "за́пись",
  "Запись": "За́пись",
  "записи": "за́писи",
  "Записи": "За́писи",
  "прайса": "пра́йса",
  "каталог": "катало́г",
  "Каталог": "Катало́г",
  "администратор": "администра́тор",
  "администратора": "администра́тора",
  "стоматологии": "стоматоло́гии",
  "стоматологиям": "стоматоло́гиям",
  "процедуры": "процеду́ры",
  "салона": "сало́на",
  "салонам": "сало́нам",
  "клиники": "кли́ники",
  "клиникам": "кли́никам",
  "механика": "меха́ника",
  "стоимость": "сто́имость",
  "специалист": "специали́ст",
  "специалисту": "специали́сту",
  "сотрудников": "сотру́дников",
  "сценарий": "сцена́рий",
  "круглосуточно": "круглосу́точно",
  "мессенджере": "ме́ссенджере",
  "автоматически": "автомати́чески",
  "структурированная": "структури́рованная",
  "подтверждения": "подтвержде́ния",
  "профиле": "про́филе",
  "консультант": "консульта́нт",
  "актуальным": "актуа́льным",
  "условиям": "усло́виям",
  "вариантам": "вариа́нтам",
  "типовые": "типовы́е",
  "диалога": "диало́га",
  "сервисным": "се́рвисным",
  "бизнесам": "би́знесам",
  "консультация": "консульта́ция",
  "решение": "реше́ние",
  "компанией": "компа́нией",
  "Филипс": "Фи́липс",
});

function languageOf(locale: string): string {
  return locale.trim().replace(/_/g, "-").split("-")[0].toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWholeTerm(text: string, source: string, replacement: string): string {
  const escaped = escapeRegExp(source);
  const pattern = new RegExp(
    "(?<![\\p{L}\\p{N}_])" + escaped + "(?![\\p{L}\\p{N}_])",
    "gu",
  );
  return text.replace(pattern, replacement);
}

export function applyDefaultLocalePronunciation(text: string, locale: string): string {
  if (languageOf(locale) !== "ru") return text;

  return Object.entries(RUSSIAN_STRESS_PRONUNCIATION)
    .sort(([a], [b]) => b.length - a.length)
    .reduce(
      (result, [source, replacement]) =>
        replaceWholeTerm(result, source, replacement),
      text,
    );
}
