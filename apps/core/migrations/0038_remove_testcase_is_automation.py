from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0037_remove_testcase_attachment"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="testcase",
            name="is_automation",
        ),
    ]
