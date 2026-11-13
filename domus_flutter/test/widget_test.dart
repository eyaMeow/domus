import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:domus_flutter/main.dart';

Future<void> pumpReadyApp(WidgetTester tester) async {
  await tester.pumpWidget(const DomusApp());
  await tester.pump(const Duration(milliseconds: 800));
  await tester.pump();
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('shows the branded loading splash', (tester) async {
    await tester.pumpWidget(const DomusApp());

    expect(find.text('domus.'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 800));
    await tester.pump();
  });

  testWidgets('shows the Domus discovery screen', (tester) async {
    await pumpReadyApp(tester);

    expect(find.text('Explorer les biens'), findsOneWidget);
    expect(find.text('Publier'), findsOneWidget);
    expect(find.text('Messages'), findsOneWidget);
  });

  testWidgets('shows an interactive OpenFreeMap without a provider key', (
    tester,
  ) async {
    await pumpReadyApp(tester);
    await tester.tap(find.text('Carte'));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('property-openfreemap-map')),
      findsOneWidget,
    );
    expect(find.text('Me localiser'), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsNothing);
    expect(
      find.text(
        'Les annonces affichées ont un emplacement choisi par leur propriétaire.',
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'opens and closes search filters without disposing controllers early',
    (tester) async {
      await pumpReadyApp(tester);
      await tester.tap(find.byIcon(Icons.tune));
      await tester.pumpAndSettle();

      expect(find.text('Filtres de recherche'), findsOneWidget);
      await tester.tap(find.text('Effacer les filtres'));
      await tester.pumpAndSettle();

      expect(find.text('Filtres de recherche'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'supports English and Arabic from settings without a currency choice',
    (tester) async {
      await pumpReadyApp(tester);
      await tester.tap(find.text('Profil'));
      await tester.pumpAndSettle();
      await tester.drag(
        find.byKey(const ValueKey('profile-list')),
        const Offset(0, -900),
      );
      await tester.pumpAndSettle();
      ScaffoldMessenger.of(tester.element(find.byType(Scaffold)))
          .hideCurrentSnackBar();
      await tester.pumpAndSettle();
      final settings = find.text('Paramètres');
      await tester.ensureVisible(settings.first);
      await tester.pumpAndSettle();
      await tester.tap(settings.first);
      await tester.pumpAndSettle();

      expect(find.text('Langue'), findsOneWidget);
      expect(find.text('Devise'), findsNothing);
      await tester.tap(find.text('English'));
      await tester.pumpAndSettle();
      expect(find.text('Settings'), findsOneWidget);
      expect(find.text('Language'), findsOneWidget);

      await tester.tap(find.text('Arabic'));
      await tester.pumpAndSettle();
      expect(find.text('الإعدادات'), findsOneWidget);
      expect(find.text('اللغة'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.home_outlined));
      await tester.pumpAndSettle();
      expect(find.text('استكشف العقارات'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.tune));
      await tester.pumpAndSettle();
      expect(find.text('عوامل تصفية البحث'), findsOneWidget);
      expect(find.text('مسح عوامل التصفية'), findsOneWidget);
      await tester.tap(find.text('مسح عوامل التصفية'));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.map_outlined));
      await tester.pumpAndSettle();
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        1,
      );
      expect(find.text('عقارات بالقرب منك'), findsOneWidget);
      expect(find.text('تحديد موقعي'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.add_circle_outline));
      await tester.pumpAndSettle();
      expect(find.text('أضف إعلانًا'), findsOneWidget);
      expect(find.text('كلمة المرور'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.chat_bubble_outline));
      await tester.pumpAndSettle();
      expect(find.text('الرسائل'), findsWidgets);
      expect(
        find.text('سجّل الدخول لحفظ المفضلة والتواصل مع المالكين.'),
        findsOneWidget,
      );

      await tester.tap(find.byIcon(Icons.person_outline));
      await tester.pumpAndSettle();
      expect(find.text('ملفي الشخصي'), findsWidgets);
    },
  );

  testWidgets('hides password recovery and verification resend controls', (
    tester,
  ) async {
    await pumpReadyApp(tester);
    await tester.tap(find.text('Profil'));
    await tester.pumpAndSettle();

    expect(find.text('Mot de passe oublié ?'), findsNothing);
    expect(find.text('Renvoyer le courriel'), findsNothing);
    expect(find.text('Renvoyer le courriel de vérification'), findsNothing);
  });

  testWidgets('offers local notifications without provider setup', (
    tester,
  ) async {
    await pumpReadyApp(tester);
    await tester.tap(find.text('Profil'));
    await tester.pumpAndSettle();
    ScaffoldMessenger.of(tester.element(find.byType(Scaffold)))
        .hideCurrentSnackBar();
    await tester.drag(find.byType(ListView).last, const Offset(0, -900));
    await tester.pumpAndSettle();
    final settings = find.text('Paramètres').first;
    await tester.ensureVisible(settings);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Paramètres').first);
    await tester.pumpAndSettle();

    expect(find.text('Notifications locales'), findsOneWidget);
    expect(find.textContaining('ne requièrent pas Firebase'), findsOneWidget);
    expect(
      tester
          .widget<SwitchListTile>(find.byType(SwitchListTile).first)
          .onChanged,
      isNotNull,
    );
  });
}
