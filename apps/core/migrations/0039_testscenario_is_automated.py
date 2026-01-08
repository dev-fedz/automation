from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0038_remove_testcase_is_automation"),
    ]

    operations = [
        migrations.AddField(
            model_name="testscenario",
            name="is_automated",
            field=models.BooleanField(default=True),
        ),
    ]
