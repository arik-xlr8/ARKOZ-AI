# ARKOZ AI — Kullanım kılavuzu

Uygulamayı Docker kullanmadan başlatmak için proje klasöründe `npm run dev` çalıştırın. Panel: http://localhost:4200.

## Otonom fabrika

1. Üstteki simülasyon alanında **Otonom fabrika** modunu seçin.
2. Aynı olay akışını tekrar görmek istiyorsanız simülasyon tohumunu değiştirmeyin. Farklı bir tohum, arıza zamanlarıyla birlikte uygun hedef cihazları da değiştirir.
3. **Otonom fabrikayı başlat** düğmesine basın. On ekipman birlikte çalışır; yük, yıpranma ve birbirine bağlı proses etkileri ilerler.
4. Her 3 gerçek saniyede 15 simülasyon dakikası eklenir. Yan yana duran **+1 saat** ve **+1 gün** düğmeleri sırasıyla dört ve 96 örnek ilerletir.
5. Her günün sonunda TimesFM ile 24 saatlik sensör görünümü hazırlanır. Risk motoru kritik ekipmanları belirler; Gemini kanıtları Türkçe yorumlar.
6. **Günlük Analizler** sayfasında gün özeti, sonraki gün görünümü, önerilen odaklar ve risk değişim zaman çizelgesi görünür.
7. Bir bakım görevini **Tamamlandı** yaptığınızda otonom simülasyondaki aktif bozulma etkisi kaldırılır ve yıpranma azaltılır. Sonraki sensör örneklerinde riskin normale dönüşü izlenebilir.
8. **Başa al**, akışı durdurup Gün 1 · Adım 0'a döndürür. Seçili mod ve tohum korunur; o çalışmanın raporları, risk olayları, alarmları ve bakım görevleri temizlenir. Ardından **Otonom fabrikayı başlat** ile aynı tohumdan yeniden çalıştırabilirsiniz.

Sağ üstteki fabrika takviminde ortadaki beyaz çerçeveli kare güncel simülasyon gününü gösterir. Soldaki iki gün geçmiş olduğu için daha silik, sağdaki iki gün gelecek olduğu için daha belirgindir. Simülasyon yeni güne geçtiğinde şerit yumuşak biçimde bir gün kayar; **Başa al** takvimi de ilk güne döndürür.

Otonom mod 30 simülasyon gününde otomatik durur. Yeni bir çalışma için aynı veya farklı tohumla yeniden başlatabilirsiniz. Günlük raporlar, olaylar ve sensör akışı yeni çalışma başlatıldığında temizlenir.

## Kontrollü kısa demo

1. Simülasyon alanında **Demo / test** modunu seçip **Rulman aşınması — Fırın Ana Motoru** senaryosunu seçin.
2. **Testi başlat** düğmesine basın. Her 3 saniyede 15 dakikalık simüle veri eklenir.
3. **Duraklat** ile zamanı durdurun. **+1 saat** ile dört örnek ilerleyebilirsiniz.
4. Yaklaşık dört simüle saat sonra **Fırın Ana Motoru** ayrıntılarını açın.
5. Titreşim, yatak sıcaklığı, eşikler ve yapay zekâ değerlendirmesini inceleyin.
6. **Bakım görevi oluştur** ile panel içinde bir görev açın.
7. **Bakım** sayfasında görevi Açık, Devam ediyor veya Tamamlandı olarak işaretleyin.
8. **Yapay Zekâ Asistanı** sayfasında “Fırın Ana Motoru neden yüksek riskli?” diye sorun.

## Sayfalar

| Sayfa | İşlev |
| --- | --- |
| Genel Bakış | Fabrika sağlığı ve risk sırasına göre ekipman özeti |
| Ekipmanlar | Ekipman arama, sensörler, grafikler ve bakım geçmişi |
| Alarmlar | Uyarıları inceleme ve görüldü olarak işaretleme |
| Tahminler | Ekipman, sensör ve 1–24 saatlik tahmin süresi seçimi |
| Günlük Analizler | Gün sonu Gemini değerlendirmeleri, ertesi gün görünümü ve risk olayları |
| Bakım | Kontrol önerileri, görev oluşturma ve durum takibi |
| Yapay Zekâ Asistanı | Güncel fabrika verilerine dayalı Türkçe soru-cevap |
| Ayarlar | Demo eşikleri, veri kaynağı ve servis bilgileri |

Grafikte yeşil çizgi geçmişi, mor kesikli çizgi tahmini, sarı çizgi uyarı eşiğini gösterir. **ŞİMDİ** çizgisi geçmişle geleceği ayırır. Takvimin yanındaki **Verileri yenile**, sunucudaki en güncel fabrika durumunu, alarmları ve bakım kayıtlarını getirir; simülasyon zamanını ilerletmez. Ekipman detayı, Tahminler veya Günlük Analizler sayfasındaysanız o sayfanın verileri de yenilenir. Değerlendirmedeki **Güncelle** ise yapay zekâ açıklamasını yeniden üretir.

**Görüldü olarak işaretle**, alarmın fark edildiğini belirtir; sorunu çözmez. Kontrollü testte görevi tamamlamak sensörleri değiştirmez. Otonom modda tamamlanan görev aktif bozulmayı giderir ve sonraki ölçümlere yansır. **Normal çalışma** kontrollü ve risksiz test akışıdır; kendiliğinden gelişen olaylar için **Otonom fabrika** kullanılmalıdır.

TimesFM sensör değerlerinin gelecek eğrisini ve olası simüle eşik geçişini üretir; kesin arıza tarihi vermez. Mevcut eşik aşımı ile gelecekte beklenen yeni geçiş panelde ayrı değerlendirilir. Sayısal risk kararını Gemini değil deterministik risk motoru verir. Gemini bu kanıtları, proses bağlantılarını ve bakım geçmişini kullanarak olası neden ve kontrol önerisi yazar.

Tüm ekipman ve sensör verileri simüledir. Gemini veya TimesFM kullanılamazsa sağlayıcısı açıkça belirtilen yedek sonuç gösterilir. Panel gerçek makineleri kontrol etmez; eşikler üretici onaylı güvenlik sınırları değildir ve tahminler kesin arıza garantisi vermez.
