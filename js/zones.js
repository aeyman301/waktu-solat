/* JAKIM e-Solat zone codes, grouped by state. */
window.ZONES = [
  { state: "Johor", zones: [
    ["JHR01", "Pulau Aur, Pulau Pemanggil"],
    ["JHR02", "Johor Bahru, Kota Tinggi, Mersing, Kulai"],
    ["JHR03", "Kluang, Pontian"],
    ["JHR04", "Batu Pahat, Muar, Segamat, Gemas Johor, Tangkak"]
  ]},
  { state: "Kedah", zones: [
    ["KDH01", "Kota Setar, Kubang Pasu, Pokok Sena"],
    ["KDH02", "Kuala Muda, Yan, Pendang"],
    ["KDH03", "Padang Terap, Sik"],
    ["KDH04", "Baling"],
    ["KDH05", "Bandar Baharu, Kulim"],
    ["KDH06", "Langkawi"],
    ["KDH07", "Puncak Gunung Jerai"]
  ]},
  { state: "Kelantan", zones: [
    ["KTN01", "Kota Bharu, Bachok, Machang, Pasir Mas, Pasir Puteh, Tanah Merah, Tumpat, Kuala Krai, Mukim Chiku"],
    ["KTN02", "Gua Musang (Galas, Bertam), Jeli, Jajahan Kecil Lojing"]
  ]},
  { state: "Melaka", zones: [
    ["MLK01", "Seluruh Negeri Melaka"]
  ]},
  { state: "Negeri Sembilan", zones: [
    ["NGS01", "Tampin, Jempol"],
    ["NGS02", "Jelebu, Kuala Pilah, Rembau"],
    ["NGS03", "Port Dickson, Seremban"]
  ]},
  { state: "Pahang", zones: [
    ["PHG01", "Pulau Tioman"],
    ["PHG02", "Kuantan, Pekan, Muadzam Shah"],
    ["PHG03", "Jerantut, Temerloh, Maran, Bera, Chenor, Jengka"],
    ["PHG04", "Bentong, Lipis, Raub"],
    ["PHG05", "Genting Sempah, Janda Baik, Bukit Tinggi"],
    ["PHG06", "Cameron Highlands, Genting Highlands, Bukit Fraser"],
    // Unconfirmed: myazan's JAKIM dump lists PHG07, but waktu.solat.my's
    // location index has no such zone and files Rompin under PHG02. Kept
    // because a missing zone cannot be chosen at all, while a spurious one is
    // visible the moment it is picked. See README, "A discrepancy worth
    // knowing about".
    ["PHG07", "Rompin (Mukim Rompin, Endau, Pontian)"]
  ]},
  { state: "Perak", zones: [
    ["PRK01", "Tapah, Slim River, Tanjung Malim"],
    ["PRK02", "Kuala Kangsar, Sg. Siput, Ipoh, Batu Gajah, Kampar"],
    ["PRK03", "Lenggong, Pengkalan Hulu, Gerik"],
    ["PRK04", "Temengor, Belum"],
    ["PRK05", "Kg Gajah, Teluk Intan, Bagan Datuk, Seri Iskandar, Beruas, Parit, Lumut, Sitiawan, Pulau Pangkor"],
    ["PRK06", "Selama, Taiping, Bagan Serai, Parit Buntar"],
    ["PRK07", "Bukit Larut"]
  ]},
  { state: "Perlis", zones: [
    ["PLS01", "Kangar, Padang Besar, Arau"]
  ]},
  { state: "Pulau Pinang", zones: [
    ["PNG01", "Seluruh Negeri Pulau Pinang"]
  ]},
  { state: "Sabah", zones: [
    ["SBH01", "Sandakan (Timur), Bukit Garam, Semawang, Temanggong, Tambisan, Bandar Sandakan, Sukau"],
    ["SBH02", "Beluran, Telupid, Pinangah, Terusan, Kuamut, Sandakan (Barat)"],
    ["SBH03", "Lahad Datu, Silabukan, Kunak, Sahabat, Semporna, Tungku, Tawau (Timur)"],
    ["SBH04", "Bandar Tawau, Balong, Merotai, Kalabakan, Tawau (Barat)"],
    ["SBH05", "Kudat, Kota Marudu, Pitas, Pulau Banggi"],
    ["SBH06", "Gunung Kinabalu"],
    ["SBH07", "Kota Kinabalu, Ranau, Kota Belud, Tuaran, Penampang, Papar, Putatan"],
    ["SBH08", "Pensiangan, Keningau, Tambunan, Nabawan, Pedalaman (Atas)"],
    ["SBH09", "Beaufort, Kuala Penyu, Sipitang, Tenom, Long Pa Sia, Membakut, Weston"]
  ]},
  { state: "Sarawak", zones: [
    ["SWK01", "Limbang, Lawas, Sundar, Trusan"],
    ["SWK02", "Miri, Niah, Bekenu, Sibuti, Marudi"],
    ["SWK03", "Pandan, Belaga, Suai, Tatau, Sebauh, Bintulu"],
    ["SWK04", "Sibu, Mukah, Dalat, Song, Igan, Oya, Balingian, Kanowit, Kapit"],
    ["SWK05", "Sarikei, Matu, Julau, Rajang, Daro, Bintangor, Belawai"],
    ["SWK06", "Lubok Antu, Sri Aman, Roban, Debak, Kabong, Lingga, Engkilili, Betong, Spaoh, Pusa, Saratok"],
    ["SWK07", "Serian, Simunjan, Samarahan, Sebuyau, Meludam"],
    ["SWK08", "Kuching, Bau, Lundu, Sematan"],
    ["SWK09", "Zon Khas (Kampung Patarikan)"]
  ]},
  { state: "Selangor", zones: [
    ["SGR01", "Gombak, Petaling, Sepang, Hulu Langat, Hulu Selangor, Shah Alam"],
    ["SGR02", "Kuala Selangor, Sabak Bernam"],
    ["SGR03", "Klang, Kuala Langat"]
  ]},
  { state: "Terengganu", zones: [
    ["TRG01", "Kuala Terengganu, Marang, Kuala Nerus"],
    ["TRG02", "Besut, Setiu"],
    ["TRG03", "Hulu Terengganu"],
    ["TRG04", "Dungun, Kemaman"]
  ]},
  { state: "Wilayah Persekutuan", zones: [
    ["WLY01", "Kuala Lumpur, Putrajaya"],
    ["WLY02", "Labuan"]
  ]}
];

window.ZONE_INDEX = window.ZONES.reduce((acc, group) => {
  group.zones.forEach(([code, area]) => {
    acc[code] = { code, area, state: group.state };
  });
  return acc;
}, {});
